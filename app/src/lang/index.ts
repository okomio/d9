import { RequestError } from '@/api';
import { createI18n, I18nOptions } from 'vue-i18n';
import availableLanguages from './available-languages.yaml';
import datetimeFormats from './date-formats.yaml';
import numberFormats from './number-formats.yaml';
import enUSBase from './translations/en-US.yaml';

export const i18n = createI18n({
	legacy: false,
	locale: 'en-US',
	fallbackLocale: 'en-US',
	messages: {
		'en-US': enUSBase,
	} as I18nOptions['messages'],
	silentTranslationWarn: true,
	datetimeFormats,
	numberFormats,
});

export type Language = keyof typeof availableLanguages;

export const loadedLanguages: Language[] = ['en-US'];

const baseMessages = new Map<string, Record<string, unknown>>([['en-US', structuredClone(enUSBase)]]);

export function recordBaseLocale(locale: string, messages: Record<string, unknown>) {
	if (!baseMessages.has(locale)) baseMessages.set(locale, structuredClone(messages));
}
export function resetScopedLocaleMessages() {
	for (const [locale, messages] of baseMessages) i18n.global.setLocaleMessage(locale, structuredClone(messages));
}

export function translateAPIError(error: RequestError | string): string {
	const defaultMsg = i18n.global.t('unexpected_error');

	let code = error;

	if (typeof error === 'object') {
		code = error?.response?.data?.errors?.[0]?.extensions?.code;
	}

	if (!error) return defaultMsg;
	if (!code === undefined) return defaultMsg;
	const key = `errors.${code}`;

	const exists = i18n.global.te(key);
	if (exists === false) return defaultMsg;
	return i18n.global.t(key);
}
