import Link from "next/link";
import { brand, nixoSpaces } from "@/lib/brand";
import { LoginScene } from "@/components/login-scene";
import { NixoWordmark } from "@/components/nixo-mark";
import { NIXO_LOGO } from "@/lib/public-assets";

export default function AboutPage() {
  return (
    <LoginScene>
      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 py-10" dir="rtl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <NixoWordmark />
          <Link
            href="/"
            className="min-h-11 rounded-2xl border border-sky-400/30 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-400/10"
          >
            ورود
          </Link>
        </header>
        <article className="space-y-8 rounded-[2rem] border border-sky-400/20 bg-[#070d18]/80 p-6 shadow-[0_0_40px_rgba(34,211,238,0.1)] backdrop-blur-xl sm:p-8">
          <p className="inline-flex rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1 text-xs text-cyan-100">
            {brand.tagline}
          </p>
          <h1 className="text-3xl font-semibold leading-snug text-white sm:text-4xl">درباره نیکسو</h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={NIXO_LOGO} alt="NIXO" className="h-20 w-20 object-contain" />
          <p className="text-sm leading-8 text-slate-200 sm:text-base">
            NIXO یک پیام‌رسان مدرن، سریع، خصوصی و قابل‌توسعه است — نه کپی واتساپ یا تلگرام. حرف X یعنی Connection، Exchange،
            Cross-border و Next: دو انسان که به هم می‌رسند.
          </p>
          <p className="text-sm font-medium tracking-wide text-cyan-300">{brand.slogan}</p>
          <p className="text-sm leading-7 text-slate-300">{brand.sloganFa}</p>
          <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {brand.pillars.map((item) => (
              <li key={item.key} className="rounded-2xl border border-sky-400/15 bg-white/5 px-3 py-3">
                <span className="block text-[11px] text-cyan-200/60">{item.key}</span>
                <span className="text-white">{item.fa}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm leading-8 text-slate-300">{brand.securityNote}</p>
          <p className="text-xs text-slate-400">قابل توسعه برای {brand.surfaces.join(" · ")}</p>
          <section>
            <h2 className="mb-3 text-lg font-medium text-white">فضاهای نیکسو</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {nixoSpaces.map((space) => (
                <li key={space.id} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm">
                  <p className="text-cyan-100">{space.title}</p>
                  <p className="mt-1 text-xs leading-6 text-slate-400">{space.detail}</p>
                </li>
              ))}
            </ul>
          </section>
          <div className="flex flex-col gap-3 text-sm">
            <Link href="/docs" className="text-cyan-300 hover:underline">
              مستندات توسعه‌دهنده
            </Link>
            <Link href="/recover" className="text-cyan-300 hover:underline">
              دستگاه را از دست داده‌اید؟ بازیابی حساب — بدون دور زدن Verification
            </Link>
          </div>
        </article>
      </div>
    </LoginScene>
  );
}
