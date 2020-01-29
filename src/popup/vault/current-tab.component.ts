import {
    ChangeDetectorRef,
    Component,
    NgZone,
    OnDestroy,
    OnInit,
} from '@angular/core';

import { Router } from '@angular/router';

import { ToasterService } from 'angular2-toaster';
import { Angulartics2 } from 'angulartics2';

import { BrowserApi } from '../../browser/browserApi';

import { BroadcasterService } from 'jslib/angular/services/broadcaster.service';

import { CipherType } from 'jslib/enums/cipherType';

import { CipherView } from 'jslib/models/view/cipherView';

import { CipherService } from 'jslib/abstractions/cipher.service';
import { I18nService } from 'jslib/abstractions/i18n.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';
import { SearchService } from 'jslib/abstractions/search.service';
import { StorageService } from 'jslib/abstractions/storage.service';
import { SyncService } from 'jslib/abstractions/sync.service';

import { ConstantsService } from 'jslib/services/constants.service';

import { AutofillService } from '../../services/abstractions/autofill.service';

import { PopupUtilsService } from '../services/popup-utils.service';

import { Utils } from 'jslib/misc/utils';

const BroadcasterSubscriptionId = 'CurrentTabComponent';

@Component({
    selector: 'app-current-tab',
    templateUrl: 'current-tab.component.html',
})
export class CurrentTabComponent implements OnInit, OnDestroy {
    pageDetails: any[] = [];
    cardCiphers: CipherView[];
    identityCiphers: CipherView[];
    loginCiphers: CipherView[];
    url: string;
    hostname: string;
    searchText: string;
    inSidebar = false;
    showLeftHeader = false;
    searchTypeSearch = false;
    loaded = false;

    private totpCode: string;
    private totpTimeout: number;
    private loadedTimeout: number;
    private searchTimeout: number;

    constructor(private platformUtilsService: PlatformUtilsService, private cipherService: CipherService,
        private popupUtilsService: PopupUtilsService, private autofillService: AutofillService,
        private analytics: Angulartics2, private toasterService: ToasterService,
        private i18nService: I18nService, private router: Router,
        private ngZone: NgZone, private broadcasterService: BroadcasterService,
        private changeDetectorRef: ChangeDetectorRef, private syncService: SyncService,
        private searchService: SearchService, private storageService: StorageService) {
    }

    async ngOnInit() {
        this.showLeftHeader = this.searchTypeSearch = !this.platformUtilsService.isSafari();
        this.inSidebar = this.popupUtilsService.inSidebar(window);

        this.broadcasterService.subscribe(BroadcasterSubscriptionId, (message: any) => {
            this.ngZone.run(async () => {
                switch (message.command) {
                    case 'syncCompleted':
                        if (this.loaded) {
                            window.setTimeout(() => {
                                this.load();
                            }, 500);
                        }
                        break;
                    case 'collectPageDetailsResponse':
                        if (message.sender === BroadcasterSubscriptionId) {
                            this.pageDetails.push({
                                frameId: message.webExtSender.frameId,
                                tab: message.tab,
                                details: message.details,
                            });
                        }
                        break;
                    default:
                        break;
                }

                this.changeDetectorRef.detectChanges();
            });
        });

        if (!this.syncService.syncInProgress) {
            await this.load();
        } else {
            this.loadedTimeout = window.setTimeout(async () => {
                if (!this.loaded) {
                    await this.load();
                }
            }, 5000);
        }

        window.setTimeout(() => {
            document.getElementById('search').focus();
        }, 100);
    }

    ngOnDestroy() {
        window.clearTimeout(this.loadedTimeout);
        this.broadcasterService.unsubscribe(BroadcasterSubscriptionId);
    }

    async refresh() {
        await this.load();
    }

    addCipher() {
        this.router.navigate(['/add-cipher'], { queryParams: { name: this.hostname, uri: this.url } });
    }

    viewCipher(cipher: CipherView) {
        this.router.navigate(['/view-cipher'], { queryParams: { cipherId: cipher.id } });
    }

    async fillCipher(cipher: CipherView) {
        this.totpCode = null;
        if (this.totpTimeout != null) {
            window.clearTimeout(this.totpTimeout);
        }

        if (this.pageDetails == null || this.pageDetails.length === 0) {
            this.analytics.eventTrack.next({ action: 'Autofilled Error' });
            this.toasterService.popAsync('error', null, this.i18nService.t('autofillError'));
            return;
        }

        try {
            this.totpCode = await this.autofillService.doAutoFill({
                cipher: cipher,
                pageDetails: this.pageDetails,
                doc: window.document,
            });
            this.analytics.eventTrack.next({ action: 'Autofilled' });
            if (this.totpCode != null) {
                this.platformUtilsService.copyToClipboard(this.totpCode, { window: window });
            }
            if (this.popupUtilsService.inPopup(window)) {
                BrowserApi.closePopup(window);
            }
        } catch {
            this.ngZone.run(() => {
                this.analytics.eventTrack.next({ action: 'Autofilled Error' });
                this.toasterService.popAsync('error', null, this.i18nService.t('autofillError'));
                this.changeDetectorRef.detectChanges();
            });
        }
    }

    searchVault() {
        if (this.searchTimeout != null) {
            clearTimeout(this.searchTimeout);
        }
        if (!this.searchService.isSearchable(this.searchText)) {
            return;
        }
        this.searchTimeout = window.setTimeout(async () => {
            this.router.navigate(['/tabs/vault'], { queryParams: { searchText: this.searchText } });
        }, 200);
    }

    private async load() {
        const tab = await BrowserApi.getTabFromCurrentWindow();
        if (tab != null) {
            this.url = tab.url;
        } else {
            this.loginCiphers = [];
            this.loaded = true;
            return;
        }

        this.hostname = Utils.getHostname(this.url);
        this.pageDetails = [];
        BrowserApi.tabSendMessage(tab, {
            command: 'collectPageDetails',
            tab: tab,
            sender: BroadcasterSubscriptionId,
        });

        const otherTypes: CipherType[] = [];
        const dontShowCards = await this.storageService.get<boolean>(ConstantsService.dontShowCardsCurrentTab);
        const dontShowIdentities = await this.storageService.get<boolean>(
            ConstantsService.dontShowIdentitiesCurrentTab);
        if (!dontShowCards) {
            otherTypes.push(CipherType.Card);
        }
        if (!dontShowIdentities) {
            otherTypes.push(CipherType.Identity);
        }

        const ciphers = await this.cipherService.getAllDecryptedForUrl(this.url,
            otherTypes.length > 0 ? otherTypes : null);

        this.loginCiphers = [];
        this.cardCiphers = [];
        this.identityCiphers = [];

        ciphers.forEach((c) => {
            switch (c.type) {
                case CipherType.Login:
                    this.loginCiphers.push(c);
                    break;
                case CipherType.Card:
                    this.cardCiphers.push(c);
                    break;
                case CipherType.Identity:
                    this.identityCiphers.push(c);
                    break;
                default:
                    break;
            }
        });

        this.loginCiphers = this.loginCiphers.sort((a, b) => this.cipherService.sortCiphersByLastUsedThenName(a, b));
        this.loaded = true;
    }
}
