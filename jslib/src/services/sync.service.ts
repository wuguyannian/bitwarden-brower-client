import { CipherService } from '../abstractions/cipher.service';
import { CollectionService } from '../abstractions/collection.service';
import { CryptoService } from '../abstractions/crypto.service';
import { FolderService } from '../abstractions/folder.service';
import { MessagingService } from '../abstractions/messaging.service';
import { PolicyService } from '../abstractions/policy.service';
import { SettingsService } from '../abstractions/settings.service';
import { StorageService } from '../abstractions/storage.service';
import { SyncService as SyncServiceAbstraction } from '../abstractions/sync.service';
import { UserService } from '../abstractions/user.service';

import { CipherData } from '../models/data/cipherData';
import { CollectionData } from '../models/data/collectionData';
import { FolderData } from '../models/data/folderData';
import { OrganizationData } from '../models/data/organizationData';
import { PolicyData } from '../models/data/policyData';

import { CipherResponse } from '../models/response/cipherResponse';
import { CollectionDetailsResponse } from '../models/response/collectionResponse';
import { DomainsResponse } from '../models/response/domainsResponse';
import { FolderResponse } from '../models/response/folderResponse';
import {
    SyncCipherNotification,
    SyncFolderNotification,
} from '../models/response/notificationResponse';
import { ProfileResponse } from '../models/response/profileResponse';

const Keys = {
    lastSyncPrefix: 'lastSync_',
};

export class SyncService implements SyncServiceAbstraction {
    syncInProgress: boolean = false;

    constructor(private userService: UserService, 
        private settingsService: SettingsService, private folderService: FolderService,
        private cipherService: CipherService, private cryptoService: CryptoService,
        private collectionService: CollectionService, private storageService: StorageService,
        private messagingService: MessagingService, private logoutCallback: (expired: boolean) => Promise<void>) {
    }

    async getLastSync(): Promise<Date> {
        const userId = await this.userService.getUserId();
        if (userId == null) {
            return null;
        }

        const lastSync = await this.storageService.get<any>(Keys.lastSyncPrefix + userId);
        if (lastSync) {
            return new Date(lastSync);
        }

        return null;
    }

    async setLastSync(date: Date): Promise<any> {
        const userId = await this.userService.getUserId();
        if (userId == null) {
            return;
        }

        await this.storageService.save(Keys.lastSyncPrefix + userId, date.toJSON());
    }

    async fullSync(forceSync: boolean, allowThrowOnError = false): Promise<boolean> {
        const now = new Date();
        await this.setLastSync(now);
        return this.syncCompleted(true);
    }

    async syncUpsertFolder(notification: SyncFolderNotification, isEdit: boolean): Promise<boolean> {
        this.syncStarted();
        if (await this.userService.isAuthenticated()) {
            try {
                const localFolder = await this.folderService.get(notification.id);
                if ((!isEdit && localFolder == null) ||
                    (isEdit && localFolder != null && localFolder.revisionDate < notification.revisionDate)) {
                }
            } catch { }
        }
        return this.syncCompleted(false);
    }

    async syncDeleteFolder(notification: SyncFolderNotification): Promise<boolean> {
        this.syncStarted();
        if (await this.userService.isAuthenticated()) {
            await this.folderService.delete(notification.id);
            this.messagingService.send('syncedDeletedFolder', { folderId: notification.id });
            this.syncCompleted(true);
            return true;
        }
        return this.syncCompleted(false);
    }

    async syncUpsertCipher(notification: SyncCipherNotification, isEdit: boolean): Promise<boolean> {
        this.syncStarted();
        if (await this.userService.isAuthenticated()) {
            try {
                let shouldUpdate = true;
                const localCipher = await this.cipherService.get(notification.id);
                if (localCipher != null && localCipher.revisionDate >= notification.revisionDate) {
                    shouldUpdate = false;
                }

                let checkCollections = false;
                if (shouldUpdate) {
                    if (isEdit) {
                        shouldUpdate = localCipher != null;
                        checkCollections = true;
                    } else {
                        if (notification.collectionIds == null || notification.organizationId == null) {
                            shouldUpdate = localCipher == null;
                        } else {
                            shouldUpdate = false;
                            checkCollections = true;
                        }
                    }
                }

                if (!shouldUpdate && checkCollections && notification.organizationId != null &&
                    notification.collectionIds != null && notification.collectionIds.length > 0) {
                    const collections = await this.collectionService.getAll();
                    if (collections != null) {
                        for (let i = 0; i < collections.length; i++) {
                            if (notification.collectionIds.indexOf(collections[i].id) > -1) {
                                shouldUpdate = true;
                                break;
                            }
                        }
                    }
                }

                if (shouldUpdate) {
                }
            } catch (e) {
                if (e != null && e.statusCode === 404 && isEdit) {
                    await this.cipherService.delete(notification.id);
                    this.messagingService.send('syncedDeletedCipher', { cipherId: notification.id });
                    return this.syncCompleted(true);
                }
            }
        }
        return this.syncCompleted(false);
    }

    async syncDeleteCipher(notification: SyncCipherNotification): Promise<boolean> {
        this.syncStarted();
        if (await this.userService.isAuthenticated()) {
            await this.cipherService.delete(notification.id);
            this.messagingService.send('syncedDeletedCipher', { cipherId: notification.id });
            return this.syncCompleted(true);
        }
        return this.syncCompleted(false);
    }

    // Helpers

    private syncStarted() {
        this.syncInProgress = true;
        this.messagingService.send('syncStarted');
    }

    private syncCompleted(successfully: boolean): boolean {
        this.syncInProgress = false;
        this.messagingService.send('syncCompleted', { successfully: successfully });
        return successfully;
    }

    private async syncProfile(response: ProfileResponse) {
        const stamp = await this.userService.getSecurityStamp();
        if (stamp != null && stamp !== response.securityStamp) {
            if (this.logoutCallback != null) {
                await this.logoutCallback(true);
            }

            throw new Error('Stamp has changed');
        }

        await this.cryptoService.setEncKey(response.key);
        await this.cryptoService.setEncPrivateKey(response.privateKey);
        await this.cryptoService.setOrgKeys(response.organizations);
        await this.userService.setSecurityStamp(response.securityStamp);

        const organizations: { [id: string]: OrganizationData; } = {};
        response.organizations.forEach((o) => {
            organizations[o.id] = new OrganizationData(o);
        });
        return await this.userService.replaceOrganizations(organizations);
    }

    private async syncFolders(userId: string, response: FolderResponse[]) {
        const folders: { [id: string]: FolderData; } = {};
        response.forEach((f) => {
            folders[f.id] = new FolderData(f, userId);
        });
        return await this.folderService.replace(folders);
    }

    private async syncCollections(response: CollectionDetailsResponse[]) {
        const collections: { [id: string]: CollectionData; } = {};
        response.forEach((c) => {
            collections[c.id] = new CollectionData(c);
        });
        return await this.collectionService.replace(collections);
    }

    private async syncCiphers(userId: string, response: CipherResponse[]) {
        const ciphers: { [id: string]: CipherData; } = {};
        response.forEach((c) => {
            ciphers[c.id] = new CipherData(c, userId);
        });
        return await this.cipherService.replace(ciphers);
    }

    private async syncSettings(userId: string, response: DomainsResponse) {
        let eqDomains: string[][] = [];
        if (response != null && response.equivalentDomains != null) {
            eqDomains = eqDomains.concat(response.equivalentDomains);
        }

        if (response != null && response.globalEquivalentDomains != null) {
            response.globalEquivalentDomains.forEach((global) => {
                if (global.domains.length > 0) {
                    eqDomains.push(global.domains);
                }
            });
        }

        return this.settingsService.setEquivalentDomains(eqDomains);
    }
}
