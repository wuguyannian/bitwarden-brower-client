import { KdfType } from 'jslib/enums/kdfType';
import { TwoFactorProviderType } from 'jslib/enums/twoFactorProviderType';

import { AuthResult } from 'jslib/models/domain/authResult';
import { SymmetricCryptoKey } from 'jslib/models/domain/symmetricCryptoKey';

import { DeviceRequest } from 'jslib/models/request/deviceRequest';
import { KeysRequest } from 'jslib/models/request/keysRequest';
import { PreloginRequest } from 'jslib/models/request/preloginRequest';
import { TokenRequest } from 'jslib/models/request/tokenRequest';

import { ErrorResponse } from 'jslib/models/response/errorResponse';
import { IdentityTokenResponse } from 'jslib/models/response/identityTokenResponse';
import { IdentityTwoFactorResponse } from 'jslib/models/response/identityTwoFactorResponse';

import { ApiService } from 'jslib/abstractions/api.service';
import { AppIdService } from 'jslib/abstractions/appId.service';
import { AuthService as AuthServiceAbstraction } from 'jslib/abstractions/auth.service';
import { CryptoService } from 'jslib/abstractions/crypto.service';
import { I18nService } from 'jslib/abstractions/i18n.service';
import { MessagingService } from 'jslib/abstractions/messaging.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';
import { TokenService } from 'jslib/abstractions/token.service';
import { UserService } from 'jslib/abstractions/user.service';

export const TwoFactorProviders = {
    [TwoFactorProviderType.Authenticator]: {
        type: TwoFactorProviderType.Authenticator,
        name: null as string,
        description: null as string,
        priority: 1,
        sort: 1,
        premium: false,
    },
    [TwoFactorProviderType.Yubikey]: {
        type: TwoFactorProviderType.Yubikey,
        name: null as string,
        description: null as string,
        priority: 3,
        sort: 2,
        premium: true,
    },
    [TwoFactorProviderType.Duo]: {
        type: TwoFactorProviderType.Duo,
        name: 'Duo',
        description: null as string,
        priority: 2,
        sort: 3,
        premium: true,
    },
    [TwoFactorProviderType.OrganizationDuo]: {
        type: TwoFactorProviderType.OrganizationDuo,
        name: 'Duo (Organization)',
        description: null as string,
        priority: 10,
        sort: 4,
        premium: false,
    },
    [TwoFactorProviderType.U2f]: {
        type: TwoFactorProviderType.U2f,
        name: null as string,
        description: null as string,
        priority: 4,
        sort: 5,
        premium: true,
    },
    [TwoFactorProviderType.Email]: {
        type: TwoFactorProviderType.Email,
        name: null as string,
        description: null as string,
        priority: 0,
        sort: 6,
        premium: false,
    },
};

export class AuthService implements AuthServiceAbstraction {
    email: string;
    masterPasswordHash: string;
    twoFactorProvidersData: Map<TwoFactorProviderType, { [key: string]: string; }>;
    selectedTwoFactorProviderType: TwoFactorProviderType = null;

    private key: SymmetricCryptoKey;
    private kdf: KdfType;
    private kdfIterations: number;

    constructor(private cryptoService: CryptoService, private apiService: ApiService,
        private userService: UserService, private tokenService: TokenService,
        private appIdService: AppIdService, private i18nService: I18nService,
        private platformUtilsService: PlatformUtilsService, private messagingService: MessagingService,
        private setCryptoKeys = true) { }

    init() {
        TwoFactorProviders[TwoFactorProviderType.Email].name = this.i18nService.t('emailTitle');
        TwoFactorProviders[TwoFactorProviderType.Email].description = this.i18nService.t('emailDesc');

        TwoFactorProviders[TwoFactorProviderType.Authenticator].name = this.i18nService.t('authenticatorAppTitle');
        TwoFactorProviders[TwoFactorProviderType.Authenticator].description =
            this.i18nService.t('authenticatorAppDesc');

        TwoFactorProviders[TwoFactorProviderType.Duo].description = this.i18nService.t('duoDesc');

        TwoFactorProviders[TwoFactorProviderType.OrganizationDuo].name =
            'Duo (' + this.i18nService.t('organization') + ')';
        TwoFactorProviders[TwoFactorProviderType.OrganizationDuo].description =
            this.i18nService.t('duoOrganizationDesc');

        TwoFactorProviders[TwoFactorProviderType.U2f].name = this.i18nService.t('u2fTitle');
        TwoFactorProviders[TwoFactorProviderType.U2f].description = this.i18nService.t('u2fDesc');

        TwoFactorProviders[TwoFactorProviderType.Yubikey].name = this.i18nService.t('yubiKeyTitle');
        TwoFactorProviders[TwoFactorProviderType.Yubikey].description = this.i18nService.t('yubiKeyDesc');
    }

    async logIn(email: string, masterPassword: string): Promise<AuthResult> {
        this.selectedTwoFactorProviderType = null;
        const key = await this.makePreloginKey(masterPassword, email);
        const hashedPassword = await this.cryptoService.hashPassword(masterPassword, key);
        return await this.logInHelper(email, hashedPassword, key);
    }

    async logInTwoFactor(twoFactorProvider: TwoFactorProviderType, twoFactorToken: string,
        remember?: boolean): Promise<AuthResult> {
        return await this.logInHelper(this.email, this.masterPasswordHash, this.key, twoFactorProvider,
            twoFactorToken, remember);
    }

    async logInComplete(email: string, masterPassword: string, twoFactorProvider: TwoFactorProviderType,
        twoFactorToken: string, remember?: boolean): Promise<AuthResult> {
        this.selectedTwoFactorProviderType = null;
        const key = await this.makePreloginKey(masterPassword, email);
        const hashedPassword = await this.cryptoService.hashPassword(masterPassword, key);
        return await this.logInHelper(email, hashedPassword, key, twoFactorProvider, twoFactorToken, remember);
    }

    logOut(callback: Function) {
        callback();
        this.messagingService.send('loggedOut');
    }

    getSupportedTwoFactorProviders(win: Window): any[] {
        const providers: any[] = [];
        if (this.twoFactorProvidersData == null) {
            return providers;
        }

        if (this.twoFactorProvidersData.has(TwoFactorProviderType.OrganizationDuo) &&
            this.platformUtilsService.supportsDuo()) {
            providers.push(TwoFactorProviders[TwoFactorProviderType.OrganizationDuo]);
        }

        if (this.twoFactorProvidersData.has(TwoFactorProviderType.Authenticator)) {
            providers.push(TwoFactorProviders[TwoFactorProviderType.Authenticator]);
        }

        if (this.twoFactorProvidersData.has(TwoFactorProviderType.Yubikey)) {
            providers.push(TwoFactorProviders[TwoFactorProviderType.Yubikey]);
        }

        if (this.twoFactorProvidersData.has(TwoFactorProviderType.Duo) && this.platformUtilsService.supportsDuo()) {
            providers.push(TwoFactorProviders[TwoFactorProviderType.Duo]);
        }

        if (this.twoFactorProvidersData.has(TwoFactorProviderType.U2f) && this.platformUtilsService.supportsU2f(win)) {
            providers.push(TwoFactorProviders[TwoFactorProviderType.U2f]);
        }

        if (this.twoFactorProvidersData.has(TwoFactorProviderType.Email)) {
            providers.push(TwoFactorProviders[TwoFactorProviderType.Email]);
        }

        return providers;
    }

    getDefaultTwoFactorProvider(u2fSupported: boolean): TwoFactorProviderType {
        if (this.twoFactorProvidersData == null) {
            return null;
        }

        if (this.selectedTwoFactorProviderType != null &&
            this.twoFactorProvidersData.has(this.selectedTwoFactorProviderType)) {
            return this.selectedTwoFactorProviderType;
        }

        let providerType: TwoFactorProviderType = null;
        let providerPriority = -1;
        this.twoFactorProvidersData.forEach((value, type) => {
            const provider = (TwoFactorProviders as any)[type];
            if (provider != null && provider.priority > providerPriority) {
                if (type === TwoFactorProviderType.U2f && !u2fSupported) {
                    return;
                }

                providerType = type;
                providerPriority = provider.priority;
            }
        });

        return providerType;
    }

    async makePreloginKey(masterPassword: string, email: string): Promise<SymmetricCryptoKey> {
        email = email.trim().toLowerCase();
        this.kdf = KdfType.PBKDF2_SHA256;
        return this.cryptoService.makeKey(masterPassword, email, this.kdf, this.kdfIterations);
    }

    private async logInHelper(email: string, hashedPassword: string, key: SymmetricCryptoKey,
        twoFactorProvider?: TwoFactorProviderType, twoFactorToken?: string, remember?: boolean): Promise<AuthResult> {      

        this.clearState();
        this.email = email;
        this.masterPasswordHash = hashedPassword;
        this.key = key;
        const userid = await this.cryptoService.hashPassword(email, key);
        await this.userService.setInformation(userid, email,
            this.kdf, this.kdfIterations);
        await this.cryptoService.setKey(key);
        await this.cryptoService.setKeyHash(hashedPassword);

        this.messagingService.send('loggedIn');
        const result = new AuthResult();
        return result;
    }

    private clearState(): void {
        this.email = null;
        this.masterPasswordHash = null;
        this.twoFactorProvidersData = null;
        this.selectedTwoFactorProviderType = null;
    }
}
