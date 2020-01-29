import { CipherType } from 'jslib/enums';

import { CipherView } from 'jslib/models/view/cipherView';
import { LoginUriView } from 'jslib/models/view/loginUriView';
import { LoginView } from 'jslib/models/view/loginView';

import { ConstantsService } from 'jslib/services/constants.service';

import { I18nService } from 'jslib/abstractions/i18n.service';

import { Analytics } from 'jslib/misc';

import { CipherService } from 'jslib/abstractions/cipher.service';
import { LockService } from 'jslib/abstractions/lock.service';
import { StorageService } from 'jslib/abstractions/storage.service';
import { SystemService } from 'jslib/abstractions/system.service';

import { BrowserApi } from '../browser/browserApi';

import MainBackground from './main.background';

import { AutofillService } from '../services/abstractions/autofill.service';
import BrowserPlatformUtilsService from '../services/browserPlatformUtils.service';

import { NotificationsService } from 'jslib/abstractions/notifications.service';

import { Utils } from 'jslib/misc/utils';

export default class RuntimeBackground {
    private runtime: any;
    private autofillTimeout: any;
    private pageDetailsToAutoFill: any[] = [];
    private isSafari: boolean;
    private onInstalledReason: string = null;

    constructor(private main: MainBackground, private autofillService: AutofillService,
        private cipherService: CipherService, private platformUtilsService: BrowserPlatformUtilsService,
        private storageService: StorageService, private i18nService: I18nService,
        private analytics: Analytics, private notificationsService: NotificationsService,
        private systemService: SystemService, private lockService: LockService) {
        this.isSafari = this.platformUtilsService.isSafari();
        this.runtime = this.isSafari ? {} : chrome.runtime;

        // onInstalled listener must be wired up before anything else, so we do it in the ctor
        if (!this.isSafari) {
            this.runtime.onInstalled.addListener((details: any) => {
                this.onInstalledReason = details.reason;
            });
        }
    }

    async init() {
        if (!this.runtime) {
            return;
        }

        await this.checkOnInstalled();
        BrowserApi.messageListener('runtime.background', async (msg: any, sender: any, sendResponse: any) => {
            await this.processMessage(msg, sender, sendResponse);
        });
    }

    async processMessage(msg: any, sender: any, sendResponse: any) {
        switch (msg.command) {
            case 'loggedIn':
            case 'unlocked':
                await this.main.setIcon();
                await this.main.refreshBadgeAndMenu(false);
                this.notificationsService.updateConnection(msg.command === 'unlocked');
                this.systemService.cancelProcessReload();
                break;
            case 'logout':
                await this.main.logout(msg.expired);
                break;
            case 'syncCompleted':
                if (msg.successfully) {
                    setTimeout(async () => await this.main.refreshBadgeAndMenu(), 2000);
                }
                break;
            case 'openPopup':
                await this.main.openPopup();
                break;
            case 'showDialogResolve':
                this.platformUtilsService.resolveDialogPromise(msg.dialogId, msg.confirmed);
                break;
            case 'bgGetDataForTab':
                await this.getDataForTab(sender.tab, msg.responseCommand);
                break;
            case 'bgOpenNotificationBar':
                await BrowserApi.tabSendMessageData(sender.tab, 'openNotificationBar', msg.data);
                break;
            case 'bgCloseNotificationBar':
                await BrowserApi.tabSendMessageData(sender.tab, 'closeNotificationBar');
                break;
            case 'bgAdjustNotificationBar':
                await BrowserApi.tabSendMessageData(sender.tab, 'adjustNotificationBar', msg.data);
                break;
            case 'bgCollectPageDetails':
                await this.main.collectPageDetailsForContentScript(sender.tab, msg.sender, sender.frameId);
                break;
            case 'bgAddLogin':
                await this.addLogin(msg.login, sender.tab);
                break;
            case 'bgChangedPassword':
                await this.changedPassword(msg.data, sender.tab);
                break;
            case 'bgAddClose':
            case 'bgChangeClose':
                this.removeTabFromNotificationQueue(sender.tab);
                break;
            case 'bgAddSave':
                await this.saveAddLogin(sender.tab);
                break;
            case 'bgChangeSave':
                await this.saveChangePassword(sender.tab);
                break;
            case 'bgNeverSave':
                await this.saveNever(sender.tab);
                break;
            case 'bgUpdateContextMenu':
            case 'editedCipher':
            case 'addedCipher':
            case 'deletedCipher':
                await this.main.refreshBadgeAndMenu();
                break;
            case 'bgReseedStorage':
                await this.main.reseedStorage();
                break;
            case 'collectPageDetailsResponse':
                if (await this.lockService.isLocked()) {
                    return;
                }
                switch (msg.sender) {
                    case 'notificationBar':
                        const forms = this.autofillService.getFormsWithPasswordFields(msg.details);
                        await BrowserApi.tabSendMessageData(msg.tab, 'notificationBarPageDetails', {
                            details: msg.details,
                            forms: forms,
                        });
                        break;
                    case 'autofiller':
                    case 'autofill_cmd':
                        const totpCode = await this.autofillService.doAutoFillForLastUsedLogin([{
                            frameId: sender.frameId,
                            tab: msg.tab,
                            details: msg.details,
                        }], msg.sender === 'autofill_cmd');
                        if (totpCode != null) {
                            this.platformUtilsService.copyToClipboard(totpCode, { window: window });
                        }
                        break;
                    case 'contextMenu':
                        clearTimeout(this.autofillTimeout);
                        this.pageDetailsToAutoFill.push({
                            frameId: sender.frameId,
                            tab: msg.tab,
                            details: msg.details,
                        });
                        this.autofillTimeout = setTimeout(async () => await this.autofillPage(), 300);
                        break;
                    default:
                        break;
                }
                break;
            default:
                break;
        }
    }

    private async autofillPage() {
        const totpCode = await this.autofillService.doAutoFill({
            cipher: this.main.loginToAutoFill,
            pageDetails: this.pageDetailsToAutoFill,
        });

        if (totpCode != null) {
            this.platformUtilsService.copyToClipboard(totpCode, { window: window });
        }

        // reset
        this.main.loginToAutoFill = null;
        this.pageDetailsToAutoFill = [];
    }

    private async saveAddLogin(tab: any) {
        if (await this.lockService.isLocked()) {
            return;
        }

        for (let i = this.main.notificationQueue.length - 1; i >= 0; i--) {
            const queueMessage = this.main.notificationQueue[i];
            if (queueMessage.tabId !== tab.id || queueMessage.type !== 'addLogin') {
                continue;
            }

            const tabDomain = Utils.getDomain(tab.url);
            if (tabDomain != null && tabDomain !== queueMessage.domain) {
                continue;
            }

            this.main.notificationQueue.splice(i, 1);
            BrowserApi.tabSendMessageData(tab, 'closeNotificationBar');

            const loginModel = new LoginView();
            const loginUri = new LoginUriView();
            loginUri.uri = queueMessage.uri;
            loginModel.uris = [loginUri];
            loginModel.username = queueMessage.username;
            loginModel.password = queueMessage.password;
            const model = new CipherView();
            model.name = Utils.getHostname(queueMessage.uri) || queueMessage.domain;
            model.name = model.name.replace(/^www\./, '');
            model.type = CipherType.Login;
            model.login = loginModel;

            const cipher = await this.cipherService.encrypt(model);
            await this.cipherService.saveWithServer(cipher);
            this.analytics.ga('send', {
                hitType: 'event',
                eventAction: 'Added Login from Notification Bar',
            });
        }
    }

    private async saveChangePassword(tab: any) {
        if (await this.lockService.isLocked()) {
            return;
        }

        for (let i = this.main.notificationQueue.length - 1; i >= 0; i--) {
            const queueMessage = this.main.notificationQueue[i];
            if (queueMessage.tabId !== tab.id || queueMessage.type !== 'changePassword') {
                continue;
            }

            const tabDomain = Utils.getDomain(tab.url);
            if (tabDomain != null && tabDomain !== queueMessage.domain) {
                continue;
            }

            this.main.notificationQueue.splice(i, 1);
            BrowserApi.tabSendMessageData(tab, 'closeNotificationBar');

            const cipher = await this.cipherService.get(queueMessage.cipherId);
            if (cipher != null && cipher.type === CipherType.Login) {
                const model = await cipher.decrypt();
                model.login.password = queueMessage.newPassword;
                const newCipher = await this.cipherService.encrypt(model);
                await this.cipherService.saveWithServer(newCipher);
                this.analytics.ga('send', {
                    hitType: 'event',
                    eventAction: 'Changed Password from Notification Bar',
                });
            }
        }
    }

    private async saveNever(tab: any) {
        for (let i = this.main.notificationQueue.length - 1; i >= 0; i--) {
            const queueMessage = this.main.notificationQueue[i];
            if (queueMessage.tabId !== tab.id || queueMessage.type !== 'addLogin') {
                continue;
            }

            const tabDomain = Utils.getDomain(tab.url);
            if (tabDomain != null && tabDomain !== queueMessage.domain) {
                continue;
            }

            this.main.notificationQueue.splice(i, 1);
            BrowserApi.tabSendMessageData(tab, 'closeNotificationBar');

            const hostname = Utils.getHostname(tab.url);
            await this.cipherService.saveNeverDomain(hostname);
        }
    }

    private async addLogin(loginInfo: any, tab: any) {
        if (await this.lockService.isLocked()) {
            return;
        }

        const loginDomain = Utils.getDomain(loginInfo.url);
        if (loginDomain == null) {
            return;
        }

        let normalizedUsername = loginInfo.username;
        if (normalizedUsername != null) {
            normalizedUsername = normalizedUsername.toLowerCase();
        }

        const ciphers = await this.cipherService.getAllDecryptedForUrl(loginInfo.url);
        const usernameMatches = ciphers.filter((c) =>
            c.login.username != null && c.login.username.toLowerCase() === normalizedUsername);
        if (usernameMatches.length === 0) {
            const disabledAddLogin = await this.storageService.get<boolean>(
                ConstantsService.disableAddLoginNotificationKey);
            if (disabledAddLogin) {
                return;
            }
            // remove any old messages for this tab
            this.removeTabFromNotificationQueue(tab);
            this.main.notificationQueue.push({
                type: 'addLogin',
                username: loginInfo.username,
                password: loginInfo.password,
                domain: loginDomain,
                uri: loginInfo.url,
                tabId: tab.id,
                expires: new Date((new Date()).getTime() + 30 * 60000), // 30 minutes
            });
            await this.main.checkNotificationQueue(tab);
        } else if (usernameMatches.length === 1 && usernameMatches[0].login.password !== loginInfo.password) {
            const disabledChangePassword = await this.storageService.get<boolean>(
                ConstantsService.disableChangedPasswordNotificationKey);
            if (disabledChangePassword) {
                return;
            }
            this.addChangedPasswordToQueue(usernameMatches[0].id, loginDomain, loginInfo.password, tab);
        }
    }

    private async changedPassword(changeData: any, tab: any) {
        if (await this.lockService.isLocked()) {
            return;
        }

        const loginDomain = Utils.getDomain(changeData.url);
        if (loginDomain == null) {
            return;
        }

        let id: string = null;
        const ciphers = await this.cipherService.getAllDecryptedForUrl(changeData.url);
        if (changeData.currentPassword != null) {
            const passwordMatches = ciphers.filter((c) => c.login.password === changeData.currentPassword);
            if (passwordMatches.length === 1) {
                id = passwordMatches[0].id;
            }
        } else if (ciphers.length === 1) {
            id = ciphers[0].id;
        }
        if (id != null) {
            this.addChangedPasswordToQueue(id, loginDomain, changeData.newPassword, tab);
        }
    }

    private async addChangedPasswordToQueue(cipherId: string, loginDomain: string, newPassword: string, tab: any) {
        // remove any old messages for this tab
        this.removeTabFromNotificationQueue(tab);
        this.main.notificationQueue.push({
            type: 'changePassword',
            cipherId: cipherId,
            newPassword: newPassword,
            domain: loginDomain,
            tabId: tab.id,
            expires: new Date((new Date()).getTime() + 30 * 60000), // 30 minutes
        });
        await this.main.checkNotificationQueue(tab);
    }

    private removeTabFromNotificationQueue(tab: any) {
        for (let i = this.main.notificationQueue.length - 1; i >= 0; i--) {
            if (this.main.notificationQueue[i].tabId === tab.id) {
                this.main.notificationQueue.splice(i, 1);
            }
        }
    }

    private async checkOnInstalled() {
        if (this.isSafari) {
            const installedVersion = await this.storageService.get<string>(ConstantsService.installedVersionKey);
            if (installedVersion == null) {
                this.onInstalledReason = 'install';
            } else if (BrowserApi.getApplicationVersion() !== installedVersion) {
                this.onInstalledReason = 'update';
            }

            if (this.onInstalledReason != null) {
                await this.storageService.save(ConstantsService.installedVersionKey,
                    BrowserApi.getApplicationVersion());
            }
        }

        setTimeout(async () => {
            if (this.onInstalledReason != null) {
                if (this.onInstalledReason === 'install') {
                    BrowserApi.createNewTab('https://bitwarden.com/browser-start/');
                    await this.setDefaultSettings();
                }

                this.analytics.ga('send', {
                    hitType: 'event',
                    eventAction: 'onInstalled ' + this.onInstalledReason,
                });
                this.onInstalledReason = null;
            }
        }, 100);
    }

    private async setDefaultSettings() {
        // Default lock options to "on restart".
        const currentLockOption = await this.storageService.get<number>(ConstantsService.lockOptionKey);
        if (currentLockOption == null) {
            await this.storageService.save(ConstantsService.lockOptionKey, -1);
        }
    }

    private async getDataForTab(tab: any, responseCommand: string) {
        const responseData: any = {};
        if (responseCommand === 'notificationBarDataResponse') {
            responseData.neverDomains = await this.storageService.get<any>(ConstantsService.neverDomainsKey);
            responseData.disabledAddLoginNotification = await this.storageService.get<boolean>(
                ConstantsService.disableAddLoginNotificationKey);
            responseData.disabledChangedPasswordNotification = await this.storageService.get<boolean>(
                ConstantsService.disableChangedPasswordNotificationKey);
        } else if (responseCommand === 'autofillerAutofillOnPageLoadEnabledResponse') {
            responseData.autofillEnabled = await this.storageService.get<boolean>(
                ConstantsService.enableAutoFillOnPageLoadKey);
        } else if (responseCommand === 'notificationBarFrameDataResponse') {
            responseData.i18n = {
                appName: this.i18nService.t('appName'),
                close: this.i18nService.t('close'),
                yes: this.i18nService.t('yes'),
                never: this.i18nService.t('never'),
                notificationAddSave: this.i18nService.t('notificationAddSave'),
                notificationNeverSave: this.i18nService.t('notificationNeverSave'),
                notificationAddDesc: this.i18nService.t('notificationAddDesc'),
                notificationChangeSave: this.i18nService.t('notificationChangeSave'),
                notificationChangeDesc: this.i18nService.t('notificationChangeDesc'),
            };
        }

        await BrowserApi.tabSendMessageData(tab, responseCommand, responseData);
    }
}
