import * as papa from 'papaparse';

import { CipherType } from '../enums/cipherType';

import { MessagingService } from '../abstractions/messaging.service';
import { CipherService } from '../abstractions/cipher.service';
import { ExportService as ExportServiceAbstraction } from '../abstractions/export.service';
import { FolderService } from '../abstractions/folder.service';

import { CipherView } from '../models/view/cipherView';
import { CollectionView } from '../models/view/collectionView';
import { FolderView } from '../models/view/folderView';

import { CipherWithIds as CipherExport } from '../models/export/cipherWithIds';
import { FolderWithId as FolderExport } from '../models/export/folderWithId';

export class ExportService implements ExportServiceAbstraction {
    syncInProgress: boolean = false;

    constructor(private folderService: FolderService, private cipherService: CipherService,
        private messagingService: MessagingService) { }

    async getExport(format: 'csv' | 'json' = 'csv'): Promise<string> {
        let decFolders: FolderView[] = [];
        let decCiphers: CipherView[] = [];
        const promises = [];

        promises.push(this.folderService.getAllDecrypted().then((folders) => {
            decFolders = folders;
        }));

        promises.push(this.cipherService.getAllDecrypted().then((ciphers) => {
            decCiphers = ciphers;
        }));

        await Promise.all(promises);

        if (format === 'csv') {
            const foldersMap = new Map<string, FolderView>();
            decFolders.forEach((f) => {
                foldersMap.set(f.id, f);
            });

            const exportCiphers: any[] = [];
            decCiphers.forEach((c) => {
                // only export logins and secure notes
                if (c.type !== CipherType.Login && c.type !== CipherType.SecureNote) {
                    return;
                }
                if (c.organizationId != null) {
                    return;
                }

                const cipher: any = {};
                cipher.folder = c.folderId != null && foldersMap.has(c.folderId) ?
                    foldersMap.get(c.folderId).name : null;
                cipher.favorite = c.favorite ? 1 : null;
                this.buildCommonCipher(cipher, c);
                exportCiphers.push(cipher);
            });

            return papa.unparse(exportCiphers);
        } else {
            const jsonDoc: any = {
                folders: [],
                items: [],
            };

            decFolders.forEach((f) => {
                if (f.id == null) {
                    return;
                }
                const folder = new FolderExport();
                folder.build(f);
                jsonDoc.folders.push(folder);
            });

            decCiphers.forEach((c) => {
                if (c.organizationId != null) {
                    return;
                }
                const cipher = new CipherExport();
                cipher.build(c);
                cipher.collectionIds = null;
                jsonDoc.items.push(cipher);
            });

            return JSON.stringify(jsonDoc, null, '  ');
        }
    }

    async getOrganizationExport(organizationId: string, format: 'csv' | 'json' = 'csv'): Promise<string> {
        const decCollections: CollectionView[] = [];
        const decCiphers: CipherView[] = [];
        const promises = [];
        return "";

        // promises.push(this.apiService.getCollections(organizationId).then((collections) => {
        //     const collectionPromises: any = [];
        //     if (collections != null && collections.data != null && collections.data.length > 0) {
        //         collections.data.forEach((c) => {
        //             const collection = new Collection(new CollectionData(c as CollectionDetailsResponse));
        //             collectionPromises.push(collection.decrypt().then((decCol) => {
        //                 decCollections.push(decCol);
        //             }));
        //         });
        //     }
        //     return Promise.all(collectionPromises);
        // }));

        // promises.push(this.apiService.getCiphersOrganization(organizationId).then((ciphers) => {
        //     const cipherPromises: any = [];
        //     if (ciphers != null && ciphers.data != null && ciphers.data.length > 0) {
        //         ciphers.data.forEach((c) => {
        //             const cipher = new Cipher(new CipherData(c));
        //             cipherPromises.push(cipher.decrypt().then((decCipher) => {
        //                 decCiphers.push(decCipher);
        //             }));
        //         });
        //     }
        //     return Promise.all(cipherPromises);
        // }));

        // await Promise.all(promises);

        // if (format === 'csv') {
        //     const collectionsMap = new Map<string, CollectionView>();
        //     decCollections.forEach((c) => {
        //         collectionsMap.set(c.id, c);
        //     });

        //     const exportCiphers: any[] = [];
        //     decCiphers.forEach((c) => {
        //         // only export logins and secure notes
        //         if (c.type !== CipherType.Login && c.type !== CipherType.SecureNote) {
        //             return;
        //         }

        //         const cipher: any = {};
        //         cipher.collections = [];
        //         if (c.collectionIds != null) {
        //             cipher.collections = c.collectionIds.filter((id) => collectionsMap.has(id))
        //                 .map((id) => collectionsMap.get(id).name);
        //         }
        //         this.buildCommonCipher(cipher, c);
        //         exportCiphers.push(cipher);
        //     });

        //     return papa.unparse(exportCiphers);
        // } else {
        //     const jsonDoc: any = {
        //         collections: [],
        //         items: [],
        //     };

        //     decCollections.forEach((c) => {
        //         const collection = new CollectionExport();
        //         collection.build(c);
        //         jsonDoc.collections.push(collection);
        //     });

        //     decCiphers.forEach((c) => {
        //         const cipher = new CipherExport();
        //         cipher.build(c);
        //         jsonDoc.items.push(cipher);
        //     });
        //     return JSON.stringify(jsonDoc, null, '  ');
        // }
    }

    async import(file:File) : Promise<boolean> {
        this.syncStarted();
        return this.syncCompleted(true);
    }

    private syncStarted() {
        this.syncInProgress = true;
        this.messagingService.send('syncStarted');
    }

    private syncCompleted(successfully: boolean): boolean {
        this.syncInProgress = false;
        this.messagingService.send('syncCompleted', { successfully: successfully });
        return successfully;
    }

    getFileName(prefix: string = null, extension: string = 'csv'): string {
        const now = new Date();
        const dateString =
            now.getFullYear() + '' + this.padNumber(now.getMonth() + 1, 2) + '' + this.padNumber(now.getDate(), 2) +
            this.padNumber(now.getHours(), 2) + '' + this.padNumber(now.getMinutes(), 2) +
            this.padNumber(now.getSeconds(), 2);

        return 'bitwarden' + (prefix ? ('_' + prefix) : '') + '_export_' + dateString + '.' + extension;
    }

    private padNumber(num: number, width: number, padCharacter: string = '0'): string {
        const numString = num.toString();
        return numString.length >= width ? numString :
            new Array(width - numString.length + 1).join(padCharacter) + numString;
    }

    private buildCommonCipher(cipher: any, c: CipherView) {
        cipher.type = null;
        cipher.name = c.name;
        cipher.notes = c.notes;
        cipher.fields = null;
        // Login props
        cipher.login_uri = null;
        cipher.login_username = null;
        cipher.login_password = null;
        cipher.login_totp = null;

        if (c.fields) {
            c.fields.forEach((f: any) => {
                if (!cipher.fields) {
                    cipher.fields = '';
                } else {
                    cipher.fields += '\n';
                }

                cipher.fields += ((f.name || '') + ': ' + f.value);
            });
        }

        switch (c.type) {
            case CipherType.Login:
                cipher.type = 'login';
                cipher.login_username = c.login.username;
                cipher.login_password = c.login.password;
                cipher.login_totp = c.login.totp;

                if (c.login.uris) {
                    cipher.login_uri = [];
                    c.login.uris.forEach((u) => {
                        cipher.login_uri.push(u.uri);
                    });
                }
                break;
            case CipherType.SecureNote:
                cipher.type = 'note';
                break;
            default:
                return;
        }

        return cipher;
    }
}
