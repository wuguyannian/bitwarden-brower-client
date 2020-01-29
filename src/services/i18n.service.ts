import { I18nService as BaseI18nService } from 'jslib/services/i18n.service';

import { BrowserApi } from '../browser/browserApi';
import { SafariApp } from '../browser/safariApp';

export default class I18nService extends BaseI18nService {
    constructor(systemLanguage: string) {
        super(systemLanguage, BrowserApi.isSafariApi ? 'safari' : null, async (formattedLocale: string) => {
            if (BrowserApi.isSafariApi) {
                await SafariApp.sendMessageToApp('getLocaleStrings', formattedLocale);
                return (window as any).bitwardenLocaleStrings;
            } else {
                // Deprecated
                const file = await fetch(this.localesDirectory + formattedLocale + '/messages.json');
                return await file.json();
            }
        });

        this.supportedTranslationLocales = [
            'en', 'bg', 'ca', 'cs', 'da', 'de', 'en-GB', 'es', 'et', 'fa', 'fi', 'fr', 'he', 'hr', 'hu', 'id', 'it',
            'ja', 'ko', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sv', 'th', 'tr', 'uk', 'vi',
            'zh-CN', 'zh-TW',
        ];
    }

    t(id: string, p1?: string, p2?: string, p3?: string): string {
        return this.translate(id, p1, p2, p3);
    }

    translate(id: string, p1?: string, p2?: string, p3?: string): string {
        if (this.localesDirectory == null) {
            const placeholders: string[] = [];
            if (p1 != null) {
                placeholders.push(p1);
            }
            if (p2 != null) {
                placeholders.push(p2);
            }
            if (p3 != null) {
                placeholders.push(p3);
            }

            if (placeholders.length) {
                return chrome.i18n.getMessage(id, placeholders);
            } else {
                return chrome.i18n.getMessage(id);
            }
        }

        return super.translate(id, p1, p2, p3);
    }
}
