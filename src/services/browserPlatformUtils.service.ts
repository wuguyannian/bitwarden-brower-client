import { BrowserApi } from '../browser/browserApi';
import { SafariApp } from '../browser/safariApp';

import { DeviceType } from 'jslib/enums/deviceType';

import { MessagingService } from 'jslib/abstractions/messaging.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';

import { AnalyticsIds } from 'jslib/misc/analytics';

const DialogPromiseExpiration = 600000; // 10 minutes

export default class BrowserPlatformUtilsService implements PlatformUtilsService {
    identityClientId: string = 'browser';

    private showDialogResolves = new Map<number, { resolve: (value: boolean) => void, date: Date }>();
    private deviceCache: DeviceType = null;
    private analyticsIdCache: string = null;

    constructor(private messagingService: MessagingService,
        private clipboardWriteCallback: (clipboardValue: string, clearMs: number) => void) { }

    getDevice(): DeviceType {
        if (this.deviceCache) {
            return this.deviceCache;
        }

        if (this.isSafariExtension()) {
            this.deviceCache = DeviceType.SafariExtension;
        } else if (navigator.userAgent.indexOf(' Firefox/') !== -1 || navigator.userAgent.indexOf(' Gecko/') !== -1) {
            this.deviceCache = DeviceType.FirefoxExtension;
        } else if ((!!(window as any).opr && !!opr.addons) || !!(window as any).opera ||
            navigator.userAgent.indexOf(' OPR/') >= 0) {
            this.deviceCache = DeviceType.OperaExtension;
        } else if (navigator.userAgent.indexOf(' Edge/') !== -1) {
            this.deviceCache = DeviceType.EdgeExtension;
        } else if (navigator.userAgent.indexOf(' Vivaldi/') !== -1) {
            this.deviceCache = DeviceType.VivaldiExtension;
        } else if ((window as any).chrome && navigator.userAgent.indexOf(' Chrome/') !== -1) {
            this.deviceCache = DeviceType.ChromeExtension;
        }

        return this.deviceCache;
    }

    getDeviceString(): string {
        const device = DeviceType[this.getDevice()].toLowerCase();
        return device.replace('extension', '');
    }

    isFirefox(): boolean {
        return this.getDevice() === DeviceType.FirefoxExtension;
    }

    isChrome(): boolean {
        return this.getDevice() === DeviceType.ChromeExtension;
    }

    isEdge(): boolean {
        return this.getDevice() === DeviceType.EdgeExtension;
    }

    isOpera(): boolean {
        return this.getDevice() === DeviceType.OperaExtension;
    }

    isVivaldi(): boolean {
        return this.getDevice() === DeviceType.VivaldiExtension;
    }

    isSafari(): boolean {
        return this.getDevice() === DeviceType.SafariExtension;
    }

    isIE(): boolean {
        return false;
    }

    isMacAppStore(): boolean {
        return false;
    }

    analyticsId(): string {
        if (this.analyticsIdCache) {
            return this.analyticsIdCache;
        }

        this.analyticsIdCache = (AnalyticsIds as any)[this.getDevice()];
        return this.analyticsIdCache;
    }

    async isViewOpen(): Promise<boolean> {
        if (await BrowserApi.isPopupOpen()) {
            return true;
        }

        if (this.isSafari()) {
            return false;
        }

        const sidebarView = this.sidebarViewName();
        const sidebarOpen = sidebarView != null && chrome.extension.getViews({ type: sidebarView }).length > 0;
        if (sidebarOpen) {
            return true;
        }

        const tabOpen = chrome.extension.getViews({ type: 'tab' }).length > 0;
        return tabOpen;
    }

    lockTimeout(): number {
        return null;
    }

    launchUri(uri: string, options?: any): void {
        BrowserApi.createNewTab(uri, options && options.extensionPage === true);
    }

    saveFile(win: Window, blobData: any, blobOptions: any, fileName: string): void {
        BrowserApi.downloadFile(win, blobData, blobOptions, fileName);
    }

    getApplicationVersion(): string {
        return BrowserApi.getApplicationVersion();
    }

    supportsU2f(win: Window): boolean {
        if (win != null && (win as any).u2f != null) {
            return true;
        }

        return this.isChrome() || this.isOpera() || this.isVivaldi();
    }

    supportsDuo(): boolean {
        return true;
    }

    showToast(type: 'error' | 'success' | 'warning' | 'info', title: string, text: string | string[],
        options?: any): void {
        this.messagingService.send('showToast', {
            text: text,
            title: title,
            type: type,
            options: options,
        });
    }

    showDialog(text: string, title?: string, confirmText?: string, cancelText?: string, type?: string) {
        const dialogId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        this.messagingService.send('showDialog', {
            text: text,
            title: title,
            confirmText: confirmText,
            cancelText: cancelText,
            type: type,
            dialogId: dialogId,
        });
        return new Promise<boolean>((resolve) => {
            this.showDialogResolves.set(dialogId, { resolve: resolve, date: new Date() });
        });
    }

    eventTrack(action: string, label?: string, options?: any) {
        this.messagingService.send('analyticsEventTrack', {
            action: action,
            label: label,
            options: options,
        });
    }

    isDev(): boolean {
        return process.env.ENV === 'development';
    }

    isSelfHost(): boolean {
        return false;
    }

    copyToClipboard(text: string, options?: any): void {
        let win = window;
        let doc = window.document;
        if (options && (options.window || options.win)) {
            win = options.window || options.win;
            doc = win.document;
        } else if (options && options.doc) {
            doc = options.doc;
        }
        const clearing = options ? !!options.clearing : false;
        const clearMs: number = options && options.clearMs ? options.clearMs : null;
        if (this.isSafariExtension()) {
            SafariApp.sendMessageToApp('copyToClipboard', text).then(() => {
                if (!clearing && this.clipboardWriteCallback != null) {
                    this.clipboardWriteCallback(text, clearMs);
                }
            });
        } else if (this.isFirefox() && (win as any).navigator.clipboard && (win as any).navigator.clipboard.writeText) {
            (win as any).navigator.clipboard.writeText(text).then(() => {
                if (!clearing && this.clipboardWriteCallback != null) {
                    this.clipboardWriteCallback(text, clearMs);
                }
            });
        } else if ((win as any).clipboardData && (win as any).clipboardData.setData) {
            // IE specific code path to prevent textarea being shown while dialog is visible.
            (win as any).clipboardData.setData('Text', text);
            if (!clearing && this.clipboardWriteCallback != null) {
                this.clipboardWriteCallback(text, clearMs);
            }
        } else if (doc.queryCommandSupported && doc.queryCommandSupported('copy')) {
            const textarea = doc.createElement('textarea');
            textarea.textContent = text == null || text === '' ? ' ' : text;
            // Prevent scrolling to bottom of page in MS Edge.
            textarea.style.position = 'fixed';
            doc.body.appendChild(textarea);
            textarea.select();

            try {
                // Security exception may be thrown by some browsers.
                if (doc.execCommand('copy') && !clearing && this.clipboardWriteCallback != null) {
                    this.clipboardWriteCallback(text, clearMs);
                }
            } catch (e) {
                // tslint:disable-next-line
                console.warn('Copy to clipboard failed.', e);
            } finally {
                doc.body.removeChild(textarea);
            }
        }
    }

    async readFromClipboard(options?: any): Promise<string> {
        let win = window;
        let doc = window.document;
        if (options && (options.window || options.win)) {
            win = options.window || options.win;
            doc = win.document;
        } else if (options && options.doc) {
            doc = options.doc;
        }

        if (this.isSafariExtension()) {
            return await SafariApp.sendMessageToApp('readFromClipboard');
        } else if (this.isFirefox() && (win as any).navigator.clipboard && (win as any).navigator.clipboard.readText) {
            return await (win as any).navigator.clipboard.readText();
        } else if (doc.queryCommandSupported && doc.queryCommandSupported('paste')) {
            const textarea = doc.createElement('textarea');
            // Prevent scrolling to bottom of page in MS Edge.
            textarea.style.position = 'fixed';
            doc.body.appendChild(textarea);
            textarea.focus();
            try {
                // Security exception may be thrown by some browsers.
                if (doc.execCommand('paste')) {
                    return textarea.value;
                }
            } catch (e) {
                // tslint:disable-next-line
                console.warn('Read from clipboard failed.', e);
            } finally {
                doc.body.removeChild(textarea);
            }
        }
        return null;
    }

    resolveDialogPromise(dialogId: number, confirmed: boolean) {
        if (this.showDialogResolves.has(dialogId)) {
            const resolveObj = this.showDialogResolves.get(dialogId);
            resolveObj.resolve(confirmed);
            this.showDialogResolves.delete(dialogId);
        }

        // Clean up old promises
        const deleteIds: number[] = [];
        this.showDialogResolves.forEach((val, key) => {
            const age = new Date().getTime() - val.date.getTime();
            if (age > DialogPromiseExpiration) {
                deleteIds.push(key);
            }
        });
        deleteIds.forEach((id) => {
            this.showDialogResolves.delete(id);
        });
    }

    private sidebarViewName(): string {
        if ((window as any).chrome.sidebarAction && this.isFirefox()) {
            return 'sidebar';
        } else if (this.isOpera() && (typeof opr !== 'undefined') && opr.sidebarAction) {
            return 'sidebar_panel';
        }

        return null;
    }

    private isSafariExtension(): boolean {
        return (window as any).safariAppExtension === true;
    }
}
