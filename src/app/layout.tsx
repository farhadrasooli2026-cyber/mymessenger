import type { Metadata, Viewport } from "next";
import { Vazirmatn, Noto_Sans, Noto_Sans_Arabic } from "next/font/google";
import { cookies } from "next/headers";
import { Toaster } from "@/components/ui/sonner";
import { MonitorBeacon } from "@/components/monitor-beacon";
import { BiBeacon } from "@/components/bi-beacon";
import { I18nHtmlSync, I18nProvider } from "@/components/i18n-provider";
import { A11yProvider } from "@/components/a11y-provider";
import { ShortcutHelp } from "@/components/shortcut-help";
import { localeDir, parseLocale } from "@/lib/i18n/languages";
import { LANG_COOKIE, TZ_COOKIE, DEFAULT_TZ } from "@/lib/i18n/cookies";
import "./globals.css";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-sans",
});

const noto = Noto_Sans({
  subsets: ["latin", "cyrillic", "latin-ext"],
  variable: "--font-noto",
  weight: ["400", "600"],
});

const notoAr = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-noto-ar",
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "NIXO نیکسو — اتصال. تبادل. فراتر از مرزها.",
  description:
    "نیکسو پیام‌رسان و پلتفرم ارتباطی نسل جدید است: خصوصی، سریع، امن و قابل توسعه — نه کپی واتساپ یا تلگرام.",
  applicationName: "NIXO",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "NIXO",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#102824",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const jar = await cookies();
  const locale = parseLocale(jar.get(LANG_COOKIE)?.value);
  const dir = localeDir(locale);
  const tz = jar.get(TZ_COOKIE)?.value || DEFAULT_TZ;
  return (
    <html lang={locale} dir={dir} className={`${vazirmatn.variable} ${noto.variable} ${notoAr.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <I18nProvider initialLocale={locale} initialDir={dir} initialTz={tz}>
          <A11yProvider>
            <I18nHtmlSync />
            {children}
            <ShortcutHelp />
            <MonitorBeacon />
            <BiBeacon />
            <Toaster position="top-center" dir={dir} />
          </A11yProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
