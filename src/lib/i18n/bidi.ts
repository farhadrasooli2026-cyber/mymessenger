const FSI = "\u2068";
const PDI = "\u2069";
const LRI = "\u2066";
const RLI = "\u2067";

/** Wrap mixed-direction fragments so they cannot hijack surrounding layout. */
export function isolate(text: string, dir?: "ltr" | "rtl" | "auto"): string {
  if (!text) return text;
  if (dir === "ltr") return `${LRI}${text}${PDI}`;
  if (dir === "rtl") return `${RLI}${text}${PDI}`;
  return `${FSI}${text}${PDI}`;
}

export function stripIsolates(text: string) {
  return text.replace(/[\u2066-\u2069]/g, "");
}

export function htmlDir(localeDir: "rtl" | "ltr"): "rtl" | "ltr" {
  return localeDir;
}
