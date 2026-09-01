export const NIXO_LOCALES = ["fa", "en", "tr"] as const;
export type NixoLocale = (typeof NIXO_LOCALES)[number];

export const TIMEZONES = ["system", "UTC", "Asia/Tehran", "Europe/Istanbul", "America/New_York"] as const;
export type PrefsTimezone = (typeof TIMEZONES)[number];

export type DateFormatPref = "system" | "jalali" | "gregorian";
export type TimeFormatPref = "system" | "12" | "24";
export type UiFont = "vazir" | "system";
export type AutoLockSec = 0 | 30 | 60 | 300 | 600;

export type UserConsents = {
  analytics: boolean;
  contactSync: boolean;
  location: boolean;
  marketing: boolean;
};

export type UserPrefs = {
  locale: NixoLocale;
  timezone: PrefsTimezone;
  dateFormat: DateFormatPref;
  timeFormat: TimeFormatPref;
  uiFont: UiFont;
  reducedMotion: boolean;
  highContrast: boolean;
  screenReaderHints: boolean;
  autoplayVideo: boolean;
  autoplayGif: boolean;
  screenshotProtect: boolean;
  appLockEnabled: boolean;
  appLockBiometric: boolean;
  autoLockSec: AutoLockSec;
  consents: UserConsents;
};

export function defaultUserPrefs(): UserPrefs {
  return {
    locale: "fa",
    timezone: "Asia/Tehran",
    dateFormat: "jalali",
    timeFormat: "24",
    uiFont: "vazir",
    reducedMotion: false,
    highContrast: false,
    screenReaderHints: true,
    autoplayVideo: false,
    autoplayGif: true,
    screenshotProtect: false,
    appLockEnabled: false,
    appLockBiometric: false,
    autoLockSec: 60,
    consents: {
      analytics: false,
      contactSync: false,
      location: false,
      marketing: false,
    },
  };
}

export const SETTINGS_CATALOG = [
  { href: "/app/settings/account", title: "حساب", en: "Account", hint: "شماره، ایمیل، حذف، پشتیبان، Export" },
  { href: "/app/settings/profile", title: "پروفایل", en: "Profile", hint: "نام، نام کاربری، عکس، بیو" },
  { href: "/app/settings/privacy", title: "حریم خصوصی", en: "Privacy", hint: "Last Seen، عکس، کشف، مسدود" },
  { href: "/app/settings/privacy-center", title: "مرکز حریم خصوصی", en: "Privacy Center", hint: "رضایت، Export، Checkup" },
  { href: "/app/settings/security", title: "امنیت", en: "Security Center", hint: "رمز، ۲FA، Passkey، هشدار ورود" },
  { href: "/app/settings/devices", title: "دستگاه‌ها و نشست‌ها", en: "Sessions", hint: "Trusted، Logout، Remove" },
  { href: "/app/settings/lock", title: "قفل برنامه", en: "App Lock", hint: "PIN، زیست‌سنجه، Auto Lock" },
  { href: "/app/settings/notifications", title: "اعلان‌ها", en: "Notifications", hint: "دسته، Preview، DND" },
  { href: "/app/settings/appearance", title: "ظاهر", en: "Appearance", hint: "تم روشن/تیره/سیستم، اکسنت، فونت" },
  { href: "/app/settings/chat-appearance", title: "ظاهر گفتگو", en: "Chat Appearance", hint: "پس‌زمینه چت" },
  { href: "/app/settings/language", title: "زبان و منطقه", en: "Language", hint: "Locale، Timezone، تاریخ" },
  { href: "/app/settings/accessibility", title: "دسترسی‌پذیری", en: "Accessibility", hint: "حرکت کمتر، کنتراست، Screen Reader" },
  { href: "/app/settings/chats", title: "چت‌ها", en: "Chats", hint: "پوشه، پین، آرشیو" },
  { href: "/app/settings/media", title: "رسانه و داده", en: "Data & Storage", hint: "Auto Download، کیفیت، Cache" },
  { href: "/app/settings/files", title: "فایل و فضای ذخیره‌سازی", en: "Files & Storage", hint: "عکس، ویدیو، فایل، صوت" },
  { href: "/app/settings/audio", title: "صوت", en: "Voice & Audio", hint: "پخش و پیام صوتی" },
  { href: "/app/settings/stickers", title: "استیکر و ایموجی", en: "Stickers", hint: "بسته و واکنش" },
  { href: "/app/settings/story", title: "استوری", en: "Stories", hint: "حریم استوری و پاسخ" },
  { href: "/app/settings/apps", title: "برنامه‌های متصل", en: "Connected Apps", hint: "لغو دسترسی Mini App" },
  { href: "/app/settings/connected-bots", title: "ربات‌های متصل", en: "Connected Bots", hint: "لغو توکن ربات" },
  { href: "/app/settings/bots", title: "داشبورد ربات", en: "Bot Developer", hint: "ساخت و مدیریت ربات" },
  { href: "/app/settings/ai", title: "هوش مصنوعی", en: "AI", hint: "Data Controls" },
  { href: "/app/settings/business", title: "کسب‌وکار", en: "Business", hint: "پروفایل تجاری" },
  { href: "/app/settings/shop", title: "فروشگاه", en: "Shop", hint: "پرداخت و سفارش" },
  { href: "/app/settings/live", title: "پخش زنده", en: "Live", hint: "تنظیمات Live" },
] as const;
