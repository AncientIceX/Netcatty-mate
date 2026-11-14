export type LocaleOption = {
  id: string;
  label: string;
};

const detectSystemDefaultLocale = (): string => {
  try {
    const navLang = typeof navigator !== 'undefined' ? String(navigator.language || '') : '';
    const [language, ...subtags] = navLang.toLowerCase().split('-');
    if (language === 'zh') {
      // An explicit script takes precedence over the region (e.g. zh-Hans-TW).
      if (subtags.includes('hans')) return 'zh-CN';
      if (subtags.some(tag => ['tw', 'hk', 'mo', 'hant'].includes(tag))) {
        return 'zh-TW';
      }
      return 'zh-CN';
    }
    if (language === 'es') return 'es';
    if (language === 'ru') return 'ru';
  } catch {
    // ignore
  }
  return 'en';
};

export const DEFAULT_UI_LOCALE = detectSystemDefaultLocale();

// Add new languages by appending to this list and providing message dictionaries.
export const SUPPORTED_UI_LOCALES: LocaleOption[] = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'ru', label: 'Русский' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
];

const isSupportedLocale = (locale: string): boolean => {
  return SUPPORTED_UI_LOCALES.some((l) => l.id === locale);
};

export const resolveSupportedLocale = (locale: string): string => {
  if (isSupportedLocale(locale)) return locale;
  const base = locale.split('-')[0] || locale;
  const baseExact = SUPPORTED_UI_LOCALES.find((l) => l.id === base)?.id;
  if (baseExact) return baseExact;
  const basePrefix = SUPPORTED_UI_LOCALES.find((l) => l.id.startsWith(`${base}-`))?.id;
  if (basePrefix) return basePrefix;
  return DEFAULT_UI_LOCALE;
};

