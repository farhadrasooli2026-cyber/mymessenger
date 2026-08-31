import type { AiIntent, AiModelId, AiTopic, Tone } from "@/lib/ai-types";

const LEX: Record<string, { en: string; tr: string; fa: string }> = {
  hello: { en: "hello", tr: "merhaba", fa: "سلام" },
  hi: { en: "hi", tr: "selam", fa: "سلام" },
  thanks: { en: "thank you", tr: "teşekkürler", fa: "متشکرم" },
  "thank you": { en: "thank you", tr: "teşekkürler", fa: "متشکرم" },
  yes: { en: "yes", tr: "evet", fa: "بله" },
  no: { en: "no", tr: "hayır", fa: "نه" },
  please: { en: "please", tr: "lütfen", fa: "لطفاً" },
  good: { en: "good", tr: "iyi", fa: "خوب" },
  morning: { en: "good morning", tr: "günaydın", fa: "صبح بخیر" },
  night: { en: "good night", tr: "iyi geceler", fa: "شب بخیر" },
  friend: { en: "friend", tr: "arkadaş", fa: "دوست" },
  message: { en: "message", tr: "mesaj", fa: "پیام" },
  chat: { en: "chat", tr: "sohbet", fa: "گفتگو" },
  privacy: { en: "privacy", tr: "gizlilik", fa: "حریم خصوصی" },
  security: { en: "security", tr: "güvenlik", fa: "امنیت" },
  translate: { en: "translate", tr: "çevir", fa: "ترجمه" },
  summary: { en: "summary", tr: "özet", fa: "خلاصه" },
  email: { en: "email", tr: "e-posta", fa: "ایمیل" },
  meeting: { en: "meeting", tr: "toplantı", fa: "جلسه" },
  tomorrow: { en: "tomorrow", tr: "yarın", fa: "فردا" },
  today: { en: "today", tr: "bugün", fa: "امروز" },
  welcome: { en: "welcome", tr: "hoş geldiniz", fa: "خوش آمدید" },
  nixo: { en: "NIXO", tr: "NIXO", fa: "نیکسو" },
  سلام: { en: "hello", tr: "merhaba", fa: "سلام" },
  متشکرم: { en: "thank you", tr: "teşekkürler", fa: "متشکرم" },
  بله: { en: "yes", tr: "evet", fa: "بله" },
  نه: { en: "no", tr: "hayır", fa: "نه" },
  لطفا: { en: "please", tr: "lütfen", fa: "لطفاً" },
  خوب: { en: "good", tr: "iyi", fa: "خوب" },
  پیام: { en: "message", tr: "mesaj", fa: "پیام" },
  ترجمه: { en: "translate", tr: "çevir", fa: "ترجمه" },
  خلاصه: { en: "summary", tr: "özet", fa: "خلاصه" },
  merhaba: { en: "hello", tr: "merhaba", fa: "سلام" },
  teşekkürler: { en: "thank you", tr: "teşekkürler", fa: "متشکرم" },
  evet: { en: "yes", tr: "evet", fa: "بله" },
  hayır: { en: "no", tr: "hayır", fa: "نه" },
};

const UNSAFE =
  /بمب|انفجار|ساخت سلاح|child.?sex|csam|ransomware|exploit kit|how to hack (wifi|bank)|کلاهبرداری با otp|فیشینگ شماره/i;

export type AiEngineInput = {
  text: string;
  intent?: AiIntent;
  topic?: AiTopic;
  model?: AiModelId;
  lang?: "fa" | "en" | "tr";
  tone?: Tone;
  context?: { role: "user" | "assistant"; text: string }[];
  memory?: string[];
  fileText?: string;
  imageHint?: string;
};

export type AiEngineOutput = {
  text: string;
  refused: boolean;
  uncertain: boolean;
  intent: AiIntent;
  imageSvg?: string;
  suggestions?: string[];
  spamScore?: number;
};

function detectLang(text: string): "fa" | "en" | "tr" {
  if (/[آ-ی]/.test(text)) return "fa";
  if (/[ğüşıöçĞÜŞİÖÇ]/.test(text) || /\b(merhaba|teşekkür|evet|lütfen)\b/i.test(text)) return "tr";
  return "en";
}

function lookup(word: string, to: "fa" | "en" | "tr") {
  const k = word.toLowerCase().replace(/[.,!?]/g, "");
  const row = LEX[k] ?? LEX[word];
  if (!row) return word;
  return row[to];
}

export function translateText(text: string, to: "fa" | "en" | "tr") {
  const from = detectLang(text);
  if (from === to) return text;
  const parts = text.split(/(\s+)/);
  const mapped = parts.map((p) => (/\s+/.test(p) ? p : lookup(p, to)));
  const joined = mapped.join("");
  const note =
    to === "fa"
      ? "\n\n(ترجمهٔ موتور داخلی نیکسو است؛ برای عبارت‌های پیچیده ممکن است کامل نباشد.)"
      : to === "tr"
        ? "\n\n(NIXO iç çeviri motoru — karmaşık cümleler tam olmayabilir.)"
        : "\n\n(NIXO built-in lexicon. Complex sentences may be incomplete.)";
  return joined + note;
}

export function summarizeText(text: string, model: AiModelId = "balanced") {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 40) return "متن برای خلاصه کوتاه است. همان را نگه دار:\n" + clean;
  const bits = clean.split(/(?<=[.!?؟。])\s+/).filter((s) => s.length > 12);
  const n = model === "fast" ? 2 : model === "advanced" ? 5 : 3;
  const pick = bits.slice(0, n);
  return "خلاصه:\n• " + (pick.length ? pick.join("\n• ") : clean.slice(0, 280));
}

export function rewriteText(text: string, mode: "rewrite" | "shorten" | "expand" | "grammar" | "tone", tone: Tone = "neutral") {
  const t = text.trim();
  if (mode === "shorten") {
    const s = t.split(/\s+/).slice(0, Math.max(8, Math.ceil(t.split(/\s+/).length * 0.55))).join(" ");
    return s + (t.endsWith(".") || t.endsWith("۔") ? "" : ".");
  }
  if (mode === "expand") {
    return `${t}\n\nجزئیات بیشتر: این نسخه برای وضوح، زمینه و گام بعدی گسترش یافته است. اگر مخاطب خاصی مدنظر است بگو تا لحن را تنظیم کنم.`;
  }
  if (mode === "grammar") {
    return t
      .replace(/\s+/g, " ")
      .replace(/\s+([,.!?])/g, "$1")
      .replace(/\bi\b/g, "I")
      .replace(/(^\w)/, (m) => m.toUpperCase());
  }
  if (mode === "tone") {
    if (tone === "formal") return `با احترام،\n${t}\nبا سپاس.`;
    if (tone === "friendly") return `سلام! ${t} 🌿`;
    if (tone === "short") return t.split(/\s+/).slice(0, 12).join(" ");
    return t;
  }
  return `بازنویسی:\n${t.replace(/\s+/g, " ").trim()}`;
}

export function writeCopy(kind: string, prompt: string, lang: "fa" | "en" | "tr") {
  const topic = prompt.replace(/^(email|message|caption|ad|description|post|ایمیل|پیام|کپشن|تبلیغ|توضیح)\s*/i, "").trim() || prompt;
  if (lang === "en") {
    if (kind === "email") return `Subject: ${topic.slice(0, 60)}\n\nHi,\n\nI am writing about ${topic}. Please let me know a time that works.\n\nBest,\n`;
    if (kind === "caption") return `${topic} — connecting beyond borders. #NIXO`;
    if (kind === "ad") return `Discover ${topic}. Fast, private, built for real conversations. Try NIXO.`;
    return `${topic}\n\nA clear ${kind} draft. Edit names and facts before sending. This is generated text, not a verified claim.`;
  }
  if (lang === "tr") {
    return `${topic} hakkında kısa bir ${kind} taslağı:\nMerhaba, ${topic} için yazıyorum. Uygun zamanı paylaşır mısınız?\n\nSaygılarımla.`;
  }
  const map: Record<string, string> = {
    email: `موضوع: ${topic.slice(0, 48)}\n\nسلام،\nدربارهٔ ${topic} می‌نویسم. اگر ممکن است زمان مناسب را بگویید.\n\nبا احترام`,
    message: `سلام، دربارهٔ ${topic} پیام می‌دهم. هر وقت دیدی جواب بده.`,
    caption: `${topic} — اتصال بدون مرز. #نیکسو`,
    ad: `${topic} را در نیکسو پیدا کن. سریع، خصوصی، برای گفتگوی واقعی.`,
    description: `${topic}: توضیح کوتاه برای پروفایل یا محصول. قبل از انتشار واقعیت‌ها را خودت چک کن.`,
    post: `${topic}\n\nنیکسو برای اتصال و تبادل است، نه برای ادعای حقیقت قطعی از طرف AI.`,
  };
  return map[kind] ?? `متن ${kind}:\n${topic}`;
}

export function suggestReplies(incoming: string): string[] {
  const t = incoming.toLowerCase();
  if (/thanks|متشکر|تشکر|teşekkür/.test(t)) return ["خواهش می‌کنم.", "Thank you!", "Rica ederim."];
  if (/ok|باشه|tamam|sure/.test(t)) return ["باشه، چک می‌کنم.", "Sounds good.", "Sure, I'll check."];
  if (/\?|؟/.test(incoming)) return ["الان نگاه می‌کنم و می‌گویم.", "I'll check and get back to you.", "Kontrol edip dönerim."];
  return ["Sounds good.", "Thank you!", "Sure, I'll check."];
}

export function spamSignal(text: string) {
  let score = 0;
  if (/(free money|crypto giveaway|otp.*(send|بفرست)|click here now|برنده شدی)/i.test(text)) score += 70;
  if (/(https?:\/\/\S+){3,}/.test(text)) score += 20;
  if (/(.)\1{8,}/.test(text)) score += 15;
  return Math.min(100, score);
}

function inferIntent(text: string, explicit?: AiIntent): AiIntent {
  if (explicit) return explicit;
  const t = text.toLowerCase();
  if (/ترجم|translate|çevir/.test(t)) return "translate";
  if (/خلاصه|summar/.test(t)) return "summarize";
  if (/بازنویس|rewrite|improve/.test(t)) return "rewrite";
  if (/کوتاه|shorten/.test(t)) return "shorten";
  if (/گسترش|expand/.test(t)) return "expand";
  if (/لحن|tone/.test(t)) return "tone";
  if (/grammar|غلط|اصلاح/.test(t)) return "grammar";
  if (/ایمیل|کپشن|تبلیغ|caption|email|advert/.test(t)) return "write";
  if (/ایده|idea/.test(t)) return "ideas";
  if (/تصویر بساز|wallpaper|image|عکس بساز/.test(t)) return "image";
  if (/\bocr\b|متن داخل عکس|extract text/.test(t)) return "ocr";
  if (/describe|توصیف عکس|analyze photo/.test(t)) return "describe";
  if (/spam|هرزنامه/.test(t)) return "spam";
  return "chat";
}

function targetLang(text: string, fallback: "fa" | "en" | "tr"): "fa" | "en" | "tr" {
  if (/english|انگلیسی/.test(text.toLowerCase())) return "en";
  if (/turkish|ترکی|türkçe/.test(text.toLowerCase())) return "tr";
  if (/persian|farsi|فارسی/.test(text.toLowerCase())) return "fa";
  return fallback === "fa" ? "en" : "fa";
}

function writeKind(text: string) {
  if (/email|ایمیل/.test(text)) return "email";
  if (/caption|کپشن/.test(text)) return "caption";
  if (/ad|تبلیغ|advert/.test(text)) return "ad";
  if (/post|پست/.test(text)) return "post";
  if (/description|توضیح/.test(text)) return "description";
  return "message";
}

export function generateNixoWallpaper(prompt: string) {
  const safe = prompt.replace(/[<>&]/g, "").slice(0, 80);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#071614"/><stop offset="1" stop-color="#0f3d38"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="980" cy="120" r="180" fill="#fbbf24" opacity=".2"/><text x="80" y="400" fill="#ecfdf5" font-size="48" font-family="sans-serif">NIXO</text><text x="80" y="460" fill="#fbbf24" font-size="22" font-family="sans-serif">${safe}</text></svg>`;
}

export function runAiEngine(input: AiEngineInput): AiEngineOutput {
  const text = (input.text ?? "").trim().slice(0, 12_000);
  const intent = inferIntent(text, input.intent);
  if (!text && !input.fileText) {
    return { text: "متنی نفرستادی.", refused: false, uncertain: false, intent };
  }
  if (UNSAFE.test(text) || (input.fileText && UNSAFE.test(input.fileText))) {
    return {
      text: "این درخواست در محدودهٔ ایمنی نیکسو نیست. برای آسیب، کلاهبرداری، یا محتوای غیرقانونی کمک نمی‌کنم.",
      refused: true,
      uncertain: false,
      intent,
    };
  }
  if (/ignore (all )?(previous|prior) (instructions|rules)|jailbreak|DAN mode/i.test(text)) {
    return {
      text: "دستورهای داخل پیام، محدودیت ایمنی نیکسو را دور نمی‌زنند. بگو چه کار مجازی می‌خواهی.",
      refused: true,
      uncertain: false,
      intent,
    };
  }

  const model = input.model ?? "balanced";
  const ctx = (input.context ?? []).slice(-(model === "fast" ? 4 : model === "advanced" ? 16 : 10));
  const lastUser = [...ctx].reverse().find((m) => m.role === "user")?.text ?? text;
  const work = /^(ترجم|خلاصه|بازنویس|کوتاه|expand|rewrite|translate)/i.test(text) && lastUser !== text ? lastUser : text;
  const mem = input.memory ?? [];
  const memLine = mem.length ? `\n\n(از حافظهٔ اختیاری تو: ${mem.slice(0, 4).join("؛ ")})` : "";
  const lang = input.lang ?? detectLang(work);
  const disclaimer =
    "\n\n— نیکسو AI حقیقت قطعی نیست. برای امور حساس (پزشکی، حقوقی، مالی) منبع را خودت بررسی کن. اگر مطمئن نباشم می‌گویم.";

  if (intent === "translate") {
    const to = targetLang(text, lang);
    return { text: translateText(work.replace(/ترجم(ه)?( کن)?/gi, "").trim() || work, to) + memLine, refused: false, uncertain: true, intent };
  }
  if (intent === "summarize") {
    return { text: summarizeText(input.fileText || work, model) + memLine + disclaimer, refused: false, uncertain: false, intent };
  }
  if (intent === "rewrite" || intent === "shorten" || intent === "expand" || intent === "grammar" || intent === "tone") {
    const mode = intent === "rewrite" ? "rewrite" : intent === "shorten" ? "shorten" : intent === "expand" ? "expand" : intent === "grammar" ? "grammar" : "tone";
    return { text: rewriteText(work, mode, input.tone) + memLine, refused: false, uncertain: false, intent };
  }
  if (intent === "write") {
    return { text: writeCopy(writeKind(text), work, lang) + memLine, refused: false, uncertain: false, intent };
  }
  if (intent === "ideas") {
    return {
      text: `چند ایده دربارهٔ «${work.slice(0, 80)}»:\n1. نسخهٔ ساده برای شروع\n2. نسخهٔ با حریم خصوصی بیشتر\n3. نسخهٔ قابل اشتراک با تیم\nاین‌ها پیشنهادند نه برنامهٔ قطعی.`,
      refused: false,
      uncertain: true,
      intent,
    };
  }
  if (intent === "reply") {
    const suggestions = suggestReplies(work);
    return { text: suggestions.join("\n"), refused: false, uncertain: false, intent, suggestions };
  }
  if (intent === "spam") {
    const spamScore = spamSignal(work);
    return {
      text: `امتیاز کمکی هرزنامه: ${spamScore}/100. AI تنها تصمیم امنیتی نیکسو نیست؛ گزارش و Block را خودت بزن.`,
      refused: false,
      uncertain: true,
      intent,
      spamScore,
    };
  }
  if (intent === "image") {
    const imageSvg = generateNixoWallpaper(work);
    return {
      text: "تصویر SVG محلی ساخته شد (مدل تصویر خارجی وصل نیست). برای والپیپر نیکسو از همین فایل استفاده کن.",
      refused: false,
      uncertain: false,
      intent,
      imageSvg,
    };
  }
  if (intent === "ocr") {
    if (input.fileText?.trim()) {
      return { text: "متن استخراج‌شده از فایل:\n" + input.fileText.slice(0, 4000), refused: false, uncertain: false, intent };
    }
    return {
      text: "OCR کامل عکس نیاز به مدل بینایی دارد که در این برش وصل نیست. فایل متنی یا PDF متنی بفرست، یا متن را بچسبان.",
      refused: false,
      uncertain: true,
      intent,
    };
  }
  if (intent === "describe") {
    return {
      text: input.imageHint
        ? `توصیف محدود محلی: ${input.imageHint}. تحلیل دقیق پیکسل بدون مدل بینایی ممکن نیست.`
        : "برای Describe/Enhance عکس، مدل بینایی لازم است. فعلاً می‌توانی متن کنار تصویر را بفرستی.",
      refused: false,
      uncertain: true,
      intent,
    };
  }
  if (intent === "file") {
    const body = input.fileText || work;
    return { text: summarizeText(body, model) + "\n\nپرسش‌هایت دربارهٔ همین متن را بپرس." + disclaimer, refused: false, uncertain: true, intent };
  }

  const topicHint =
    input.topic === "coding"
      ? "برای کد: منطق را قدم‌به‌قدم می‌نویسم؛ اجرا را در محیط خودت تست کن."
      : input.topic === "study"
        ? "برای مطالعه: نکته‌ها را فهرست می‌کنم."
        : input.topic === "business"
          ? "برای کسب‌وکار: لحن رسمی و قابل ویرایش."
          : "";
  const follow = ctx.length ? `با توجه به ${ctx.length} پیام قبلی این گفتگو: ` : "";
  const answer =
    lang === "en"
      ? `${follow}${topicHint}\n${work}\n\nA practical take: break it into one next step, keep private data off this chat unless you chose to paste it, and double-check facts.`
      : `${follow}${topicHint}\nدربارهٔ «${work.slice(0, 180)}»:\nیک گام بعدی مشخص انتخاب کن. دادهٔ خصوصی را مگر خودت نچسبانی برای AI نمی‌فرستم. ${memLine}`;
  return { text: answer + disclaimer, refused: false, uncertain: true, intent: "chat" };
}

export function extractMemoryCandidate(text: string): string | null {
  const m = text.match(/نام من\s+(.+)|my name is\s+(.+)|اسمم\s+(.+)/i);
  if (!m) return null;
  const name = (m[1] || m[2] || m[3] || "").trim().slice(0, 40);
  return name ? `نام کاربر: ${name}` : null;
}
