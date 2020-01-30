import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { CryptoService } from 'jslib/abstractions/crypto.service';
import { EventService } from 'jslib/abstractions/event.service';
import { ExportService } from 'jslib/abstractions/export.service';
import { I18nService } from 'jslib/abstractions/i18n.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';

@Component({
    selector: 'app-import',
    templateUrl: 'import.component.html',
})
export class ImportComponent  {
    constructor(cryptoService: CryptoService, i18nService: I18nService,
        platformUtilsService: PlatformUtilsService, exportService: ExportService,
        eventService: EventService, private router: Router) {
    }

    protected saved() {
        this.router.navigate(['/tabs/settings']);
    }

    onFileSelected(file:File){
        console.log(file);
    }
}
