/** Client-visible copy. Seed intros live only on the device after E2EE bootstrap. */

export const SEED_PEERS = [
  {
    peerKey: "nixo",
    peerName: "نیکسو",
    peerTitle: "ارتباط رسمی",
    color: "#fbbf24",
    messages: [
      "سلام. به نیکسو خوش آمدی — پیام‌رسان نسل جدید برای اتصال، تبادل و ارتباط بدون مرز.",
      "حرف X در NIXO یعنی Connection، Exchange، Cross-border و Next: دو مسیر که به هم می‌رسند.",
      "نیکسو ادعا نمی‌کند غیرقابل‌هک است. امنیت اینجا از طراحی می‌آید: حریم خصوصی پیش‌فرض، Zero Trust، کمترین دسترسی، و رمزنگاری سرتاسری.",
    ],
  },
  {
    peerKey: "arya",
    peerName: "آریا کیان",
    peerTitle: "گفتگوی خصوصی",
    color: "#34d399",
    messages: [
      "رسیدی داخل نیکسو؟ مسیرش کوتاه بود.",
      "گروه، کانال و استوری را از نیکسو باز کن.",
    ],
  },
  {
    peerKey: "noor",
    peerName: "استودیو نور",
    peerTitle: "کسب‌وکار",
    color: "#7dd3fc",
    messages: ["نمونهٔ گفتگوی کاری. فایل، پرداخت و مینی‌اپ روی همین نخ ساخته می‌شوند، نه در اپ جدا."],
  },
] as const;

export const REPORT_CATEGORIES = [
  { id: "spam", label: "هرزنامه (Spam)" },
  { id: "abuse", label: "سوءاستفاده (Abuse)" },
  { id: "fake", label: "حساب جعلی (Fake Account)" },
  { id: "harassment", label: "آزار (Harassment)" },
  { id: "other", label: "سایر (Other)" },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["id"];

export function nixoLocalReply(text: string): string {
  if (/صوت|ویس|voice|امن|هک|hack|security|رمز/i.test(text)) {
    return "امنیت نیکسو تضمین مطلق نیست؛ لایه‌لایه است: احراز هویت سخت، کمترین دسترسی، و رمزنگاری سرتاسری روی دستگاه تو. متن پیام روی سرور نمی‌ماند. هر ادعای «هرگز هک نمی‌شویم» را باور نکن.";
  }
  if (/گروه|کانال|فروش|کیف|پرداخت|ai|ربات|بلاک|گزارش|عکس|ویدیو|فایل|مدیا|استوری|وضعیت|جستجو|ذخیره/i.test(text)) {
    return "رسانهٔ خصوصی E2EE است. گروه، جامعه، کانال، استوری، جستجو و Saved Messages زنده‌اند. متن چت خصوصی روی دستگاه جستجو می‌شود؛ پست عمومی فقط اگر اجازه داشته باشی.";
  }
  return "پیامت روی این دستگاه رمز شد و فقط پاکت رمزنگاری‌شده به سرور رفت. نیکسو متن را نمی‌بیند.";
}
