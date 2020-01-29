import { Location } from '@angular/common';
import { Component } from '@angular/core';
import {
    ActivatedRoute,
    Router,
} from '@angular/router';

import { CipherService } from 'jslib/abstractions/cipher.service';
import { CollectionService } from 'jslib/abstractions/collection.service';
import { I18nService } from 'jslib/abstractions/i18n.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';
import { UserService } from 'jslib/abstractions/user.service';

import { ShareComponent as BaseShareComponent } from 'jslib/angular/components/share.component';

@Component({
    selector: 'app-vault-share',
    templateUrl: 'share.component.html',
})
export class ShareComponent extends BaseShareComponent {
    constructor(collectionService: CollectionService, platformUtilsService: PlatformUtilsService,
        i18nService: I18nService, userService: UserService,
        cipherService: CipherService, private route: ActivatedRoute,
        private location: Location, private router: Router) {
        super(collectionService, platformUtilsService, i18nService, userService, cipherService);
    }

    async ngOnInit() {
        this.onSharedCipher.subscribe(() => {
            this.router.navigate(['view-cipher', { cipherId: this.cipherId }]);
        });
        const queryParamsSub = this.route.queryParams.subscribe(async (params) => {
            this.cipherId = params.cipherId;
            await this.load();
            if (queryParamsSub != null) {
                queryParamsSub.unsubscribe();
            }
        });
    }

    async submit(): Promise<boolean> {
        const success = await super.submit();
        if (success) {
            window.setTimeout(() => {
                this.location.back();
            }, 200);
        }
        return success;
    }

    cancel() {
        this.location.back();
    }
}
