import Link from "next/link";
import { brand } from "@/lib/brand";
import { NixoWordmark } from "@/components/nixo-mark";
import { RegisterFlow } from "@/components/register-flow";

export function Landing({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#071614] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(52,211,153,0.18),transparent_36%),radial-gradient(circle_at_88%_0%,rgba(251,191,36,0.16),transparent_32%),radial-gradient(circle_at_70%_90%,rgba(56,189,248,0.1),transparent_30%)]" />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-6">
        <NixoWordmark />
        {signedIn ? (
          <Link
            href="/app"
            className="rounded-full bg-amber-300 px-4 py-2 text-sm font-medium text-[#102824] hover:bg-amber-200"
          >
            ورود به نیکسو
          </Link>
        ) : (
          <p className="hidden text-xs text-emerald-100/60 md:block">{brand.slogan}</p>
        )}
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl gap-10 px-4 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        <section className="space-y-7 pt-2">
          <p className="inline-flex rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
            {brand.tagline}
          </p>
          <h1 className="max-w-xl text-3xl font-semibold leading-snug sm:text-5xl">
            نیکسو: اتصال دو مسیر، تبادل بدون مرز.
          </h1>
          <p className="max-w-xl text-sm leading-8 text-emerald-50/80 sm:text-base">
            NIXO یک پیام‌رسان مدرن، سریع، خصوصی و قابل‌توسعه است — نه کپی واتساپ یا تلگرام.
            حرف X یعنی Connection، Exchange، Cross-border و Next: دو انسان که به هم می‌رسند.
          </p>
          <p className="text-sm font-medium tracking-wide text-amber-200">{brand.slogan}</p>
          <p className="max-w-xl text-xs leading-7 text-emerald-100/65">{brand.securityNote}</p>
          <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {brand.pillars.map((item) => (
              <li key={item.key} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                <span className="block text-[11px] text-emerald-100/50">{item.key}</span>
                {item.fa}
              </li>
            ))}
          </ul>
          <p className="text-xs text-emerald-100/55">قابل توسعه برای {brand.surfaces.join(" · ")}</p>
        </section>
        {signedIn ? (
          <div className="rounded-3xl border border-white/10 bg-[#0f2f2c]/80 p-8 text-center shadow-2xl">
            <p className="text-lg font-medium">حساب شما فعال است</p>
            <p className="mt-2 text-sm text-emerald-100/70">گفتگوهای خصوصی نیکسو آماده‌اند.</p>
            <Link
              href="/app"
              className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-amber-300 text-sm font-medium text-[#102824] hover:bg-amber-200"
            >
              ادامه در نیکسو
            </Link>
          </div>
        ) : (
          <RegisterFlow />
        )}
      </main>
    </div>
  );
}
