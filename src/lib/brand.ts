export const brand = {
  name: "NIXO",
  fa: "نیکسو",
  slogan: "Connect. Exchange. Beyond Borders.",
  sloganFa: "اتصال. تبادل. فراتر از مرزها.",
  tagline: "پیام‌رسان و پلتفرم ارتباطی نسل جدید",
  xMeanings: [
    { en: "Connection", fa: "اتصال" },
    { en: "Exchange", fa: "تبادل" },
    { en: "Cross-border", fa: "ارتباط بدون مرز" },
    { en: "Next", fa: "نسل بعدی" },
  ],
  pillars: [
    { key: "Privacy", fa: "حریم خصوصی" },
    { key: "Security", fa: "امنیت" },
    { key: "Connection", fa: "اتصال" },
    { key: "Speed", fa: "سرعت" },
    { key: "Simplicity", fa: "سادگی" },
    { key: "Modern Design", fa: "طراحی مدرن" },
    { key: "Reliability", fa: "پایداری" },
    { key: "Global Communication", fa: "ارتباط جهانی" },
  ],
  surfaces: ["Android", "iPhone", "Tablet", "Windows", "macOS", "Linux", "Web"],
  securityNote:
    "نیکسو ادعا نمی‌کند که هرگز قابل نفوذ نیست؛ هیچ سامانهٔ متصل به اینترنت را نمی‌توان مطلقاً غیرقابل‌هک تضمین کرد. به‌جای آن از ابتدا با Security by Design، Privacy by Design، Zero Trust، Least Privilege، احراز هویت امن، رمزنگاری سرتاسری و زیرساخت امن طراحی می‌شود.",
} as const;

export const nixoSpaces = [
  { id: "chat", title: "گفتگوی خصوصی", detail: "فعال: متن، صوت، رسانه، View Once، پیام ناپدیدشونده، E2EE", live: true },
  { id: "group", title: "گروه", detail: "فعال: اعضا، نقش‌ها، دعوت، درخواست عضویت، نظرسنجی، پین، E2EE", live: true },
  { id: "community", title: "جامعه", detail: "فعال: چند گروه و کانال مرتبط، نقش، دعوت، اطلاعیه، مجوز سمت سرور", live: true },
  { id: "channel", title: "کانال", detail: "فعال: عمومی/خصوصی، دنبال‌کننده، پست، نظرسنجی، پین، دعوت و مجوز سمت سرور", live: true },
  { id: "story", title: "استوری", detail: "فعال: عکس/ویدیو/متن، ۲۴ساعت، حریم، آرشیو، واکنش، وضعیت", live: true },
  { id: "voice", title: "تماس صوتی", detail: "فعال: زنگ، پذیرش، سابقه، WebRTC روی دستگاه", live: true },
  { id: "video", title: "تماس تصویری", detail: "فعال: دوربین، PiP، کم‌مصرف، رمز رسانه روی دستگاه", live: true },
  { id: "files", title: "اشتراک فایل", detail: "فعال: عکس، ویدیو، سند، E2EE تکه‌تکه، جستجو و Saved Messages", live: true },
  { id: "ai", title: "هوش مصنوعی", detail: "دستیار داخل گفتگو، نه جایگزین انسان", live: false },
  { id: "business", title: "کسب‌وکار", detail: "حساب تجاری و پاسخگویی", live: false },
  { id: "bot", title: "ربات", detail: "اتوماسیون با کمترین دسترسی", live: false },
  { id: "mini", title: "مینی‌اپ", detail: "ابزارهای کوچک داخل نیکسو", live: false },
  { id: "shop", title: "فروشگاه", detail: "خرید داخل پلتفرم ارتباطی", live: false },
  { id: "pay", title: "پرداخت", detail: "تراکنش با تأیید چندلایه", live: false },
  { id: "wallet", title: "کیف پول", detail: "نگهداری ارزش، جدا از گفتگو", live: false },
] as const;
