import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { EnvironmentService } from 'jslib/abstractions/environment.service';
import { I18nService } from 'jslib/abstractions/i18n.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';

import { EnvironmentComponent as BaseEnvironmentComponent } from 'jslib/angular/components/environment.component';

@Component({
    selector: 'app-environment',
    templateUrl: 'environment.component.html',
})
export class EnvironmentComponent extends BaseEnvironmentComponent {
    constructor(platformUtilsService: PlatformUtilsService, environmentService: EnvironmentService,
        i18nService: I18nService, private router: Router) {
        super(platformUtilsService, environmentService, i18nService);
        this.showCustom = true;
    }

    saved() {
        super.saved();
        this.router.navigate(['']);
    }
}
