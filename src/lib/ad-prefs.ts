export const AD_PREF_KEY = "nixo-ad-prefs";

export type NixoAdPrefs = {
  personalized: boolean;
  activityBased: boolean;
  topics: string[];
};

export const AD_TOPICS = [
  { id: "tech", fa: "فناوری", en: "Technology" },
  { id: "music", fa: "موسیقی", en: "Music" },
  { id: "sports", fa: "ورزش", en: "Sports" },
  { id: "news", fa: "اخبار", en: "News" },
  { id: "shopping", fa: "خرید", en: "Shopping" },
  { id: "travel", fa: "سفر", en: "Travel" },
] as const;

export function defaultAdPrefs(): NixoAdPrefs {
  return { personalized: false, activityBased: false, topics: [] };
}

export function readAdPrefs(): NixoAdPrefs {
  if (typeof window === "undefined") return defaultAdPrefs();
  try {
    const raw = window.localStorage.getItem(AD_PREF_KEY);
    if (!raw) return defaultAdPrefs();
    const parsed = JSON.parse(raw) as Partial<NixoAdPrefs>;
    return {
      personalized: Boolean(parsed.personalized),
      activityBased: Boolean(parsed.activityBased),
      topics: Array.isArray(parsed.topics) ? parsed.topics.map(String).slice(0, 12) : [],
    };
  } catch {
    return defaultAdPrefs();
  }
}

export function writeAdPrefs(next: NixoAdPrefs) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AD_PREF_KEY, JSON.stringify(next));
}
