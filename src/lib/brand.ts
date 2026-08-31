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
  { id: "ai", title: "هوش مصنوعی", detail: "فعال: NIXO AI، ترجمه، نوشتن، خلاصه، ابزار روی دستگاه، Data Controls", live: true },
  { id: "business", title: "کسب‌وکار", detail: "فعال: تبدیل همین حساب، پروفایل، صندوق، کاتالوگ، سفارش، تأیید سمت سرور", live: true },
  { id: "bot", title: "ربات", detail: "فعال: ساخت، API با Permission، دستور، دکمه، Webhook، Directory و Verified", live: true },
  { id: "mini", title: "مینی‌اپ", detail: "فعال: سندباکس داخل نیکسو، اجازهٔ پروفایل، بدون OTP و کلید خصوصی", live: true },
  { id: "shop", title: "فروشگاه", detail: "فعال: فروشگاه Business، واریانت، سبد، Checkout، کوپن، فاکتور", live: true },
  { id: "pay", title: "پرداخت", detail: "فعال: سندباکس NIXO Pay با تأیید سرور، Webhook امضاشده، بدون ذخیرهٔ کارت", live: true },
  { id: "wallet", title: "کیف پول", detail: "فعال: موجودی سندباکس، انتقال با تأیید نشست، تاریخچه تراکنش", live: true },
] as const;
