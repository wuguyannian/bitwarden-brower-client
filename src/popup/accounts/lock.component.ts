import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { CryptoService } from 'jslib/abstractions/crypto.service';
import { EnvironmentService } from 'jslib/abstractions/environment.service';
import { I18nService } from 'jslib/abstractions/i18n.service';
import { LockService } from 'jslib/abstractions/lock.service';
import { MessagingService } from 'jslib/abstractions/messaging.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';
import { StateService } from 'jslib/abstractions/state.service';
import { StorageService } from 'jslib/abstractions/storage.service';
import { UserService } from 'jslib/abstractions/user.service';

import { LockComponent as BaseLockComponent } from 'jslib/angular/components/lock.component';

@Component({
    selector: 'app-lock',
    templateUrl: 'lock.component.html',
})
export class LockComponent extends BaseLockComponent {
    constructor(router: Router, i18nService: I18nService,
        platformUtilsService: PlatformUtilsService, messagingService: MessagingService,
        userService: UserService, cryptoService: CryptoService,
        storageService: StorageService, lockService: LockService,
        environmentService: EnvironmentService, stateService: StateService) {
        super(router, i18nService, platformUtilsService, messagingService, userService, cryptoService,
            storageService, lockService, environmentService, stateService);
        this.successRoute = '/tabs/current';
    }

    async ngOnInit() {
        await super.ngOnInit();
        window.setTimeout(() => {
            document.getElementById(this.pinLock ? 'pin' : 'masterPassword').focus();
        }, 100);
    }
}
