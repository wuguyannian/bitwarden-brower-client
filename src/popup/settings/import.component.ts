import { 
    Component,
    EventEmitter,
    Output,} from '@angular/core';
import { Router } from '@angular/router';

import { CryptoService } from 'jslib/abstractions/crypto.service';
import { EventService } from 'jslib/abstractions/event.service';
import { I18nService } from 'jslib/abstractions/i18n.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';
import { EventType } from 'jslib/enums/eventType';
import { ImportService } from 'jslib/abstractions/import.service';
import { Importer } from 'jslib/importers/importer';

@Component({
    selector: 'app-import',
    templateUrl: 'import.component.html',
})
export class ImportComponent  {
    @Output() onSaved = new EventEmitter();

    formPromise: Promise<string>;
    masterPassword: string;
    showPassword = false;
    selectFile: File = null;

    constructor(
        protected cryptoService: CryptoService, 
        protected i18nService: I18nService,
        protected platformUtilsService: PlatformUtilsService, 
        protected importService: ImportService,
        protected eventService: EventService, private router: Router) {
    }

    protected saved() {
        this.onSaved.emit();
        this.router.navigate(['/tabs/settings']);
    }

    onFileSelected(file:File){
        this.selectFile = file;
    }

    async submit() {
        if (this.masterPassword == null || this.masterPassword === '') {
            this.platformUtilsService.showToast('error', this.i18nService.t('errorOccurred'),
                this.i18nService.t('invalidMasterPassword'));
            return;
        }
        if (this.selectFile == null) {
            this.platformUtilsService.showToast('error', this.i18nService.t('errorOccurred'),
                this.i18nService.t('selectFile'));
            return;
        }
        else if (this.selectFile.name.search(/[.](json|csv)/) == -1) {
            this.platformUtilsService.showToast('error', this.i18nService.t('errorOccurred'),
                this.i18nService.t('fileFormat'));
            return;
        }

        const keyHash = await this.cryptoService.hashPassword(this.masterPassword, null);
        const storedKeyHash = await this.cryptoService.getKeyHash();
        if (storedKeyHash != null && keyHash != null && storedKeyHash === keyHash) {
            try {
                let importer:Importer;
                if (this.selectFile.name.search(/[.](json)/) == -1) {
                    importer = this.importService.getImporter("bitwardencsv");
                }
                else {
                    importer = this.importService.getImporter("bitwardenjson");
                }
                const reader = new FileReader();
                reader.readAsText(this.selectFile);
                reader.onload = async (evt: any) => {
                    await this.importService.import(importer, evt.target.result);
                };
                this.platformUtilsService.eventTrack('Imported Data');
                this.saved();
                await this.collectEvent();
            } catch (error) { 
                this.platformUtilsService.showToast('error', this.i18nService.t('errorOccurred'),
                error.stack);
            }
        } else {
            this.platformUtilsService.showToast('error', this.i18nService.t('errorOccurred'),
                this.i18nService.t('invalidMasterPassword'));
        }
    }

    togglePassword() {
        this.platformUtilsService.eventTrack('Toggled Master Password on Export');
        this.showPassword = !this.showPassword;
        document.getElementById('masterPassword').focus();
    }
    
    protected async collectEvent(): Promise<any> {
        await this.eventService.collect(EventType.User_ClientImportedVault);
    }
}
