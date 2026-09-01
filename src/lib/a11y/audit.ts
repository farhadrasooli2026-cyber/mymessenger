/** Static HTML accessibility checks for tests and CI. */

export type A11yIssue = { code: string; message: string };

function stripComments(html: string) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

export function auditMarkup(html: string): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const src = stripComments(html);

  const buttons = src.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi);
  for (const m of buttons) {
    const attrs = m[1] ?? "";
    const body = (m[2] ?? "").replace(/<[^>]+>/g, "").trim();
    const named = /\baria-label\s*=/.test(attrs) || /\baria-labelledby\s*=/.test(attrs) || body.length > 0;
    if (!named) issues.push({ code: "button-name", message: "Button without accessible name" });
  }

  const inputs = src.matchAll(/<(input|select|textarea)\b([^>]*)\/?>/gi);
  for (const m of inputs) {
    const attrs = m[2] ?? "";
    if (/\btype\s*=\s*["']hidden["']/i.test(attrs)) continue;
    if (/\btype\s*=\s*["']submit["']/i.test(attrs)) continue;
    const id = /\bid\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1];
    const labelled =
      /\baria-label\s*=/.test(attrs) ||
      /\baria-labelledby\s*=/.test(attrs) ||
      (id ? new RegExp(`<label[^>]+for=["']${id}["']`, "i").test(src) : false) ||
      /\btype\s*=\s*["']button["']/i.test(attrs);
    if (!labelled) issues.push({ code: "control-label", message: "Control without label" });
  }

  const imgs = src.matchAll(/<img\b([^>]*)\/?>/gi);
  for (const m of imgs) {
    const attrs = m[1] ?? "";
    if (!/\balt\s*=/.test(attrs) && !/\brole\s*=\s*["']presentation["']/.test(attrs) && !/\baria-hidden\s*=\s*["']true["']/.test(attrs)) {
      issues.push({ code: "img-alt", message: "Image without alt" });
    }
  }

  if (/<html\b[^>]*>/i.test(src) && !/<html\b[^>]*\blang=/.test(src)) {
    issues.push({ code: "html-lang", message: "html missing lang" });
  }

  return issues;
}

export function keyboardOrderOk(tabIndexes: number[]): boolean {
  const custom = tabIndexes.filter((n) => n > 0);
  if (custom.length === 0) return true;
  const sorted = [...custom].sort((a, b) => a - b);
  return sorted.every((n, i) => i === 0 || n >= sorted[i - 1]!);
}
