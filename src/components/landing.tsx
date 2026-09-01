import Link from "next/link";
import { LoginScene } from "@/components/login-scene";
import { RegisterFlow } from "@/components/register-flow";

function StatusCard({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div
      className="w-full rounded-[2rem] border border-sky-400/25 bg-[#070d18]/80 p-8 text-center shadow-[0_0_48px_rgba(34,211,238,0.12)] backdrop-blur-xl"
      dir="rtl"
    >
      <p className="text-lg font-medium text-white">{title}</p>
      <p className="mt-2 text-sm text-slate-300">{body}</p>
      <Link
        href={href}
        className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-l from-cyan-400 to-blue-500 text-sm font-medium text-white shadow-[0_0_24px_rgba(56,189,248,0.28)]"
      >
        {cta}
      </Link>
    </div>
  );
}

export function Landing({ signedIn, pendingSetup }: { signedIn: boolean; pendingSetup?: boolean }) {
  return (
    <LoginScene>
      <a href="#nixo-main" className="skip-link">
        پرش به ورود
      </a>
      <main
        id="nixo-main"
        className="relative z-10 flex min-h-dvh w-full items-center justify-center px-4 py-8 sm:px-6 lg:justify-end lg:px-10 xl:px-20"
        dir="ltr"
      >
        <div className="w-full max-w-[440px] lg:max-w-[400px] xl:max-w-[420px]">
          {signedIn ? (
            <StatusCard title="حساب شما فعال است" body="گفتگوهای خصوصی نیکسو آماده‌اند." href="/app" cta="ادامه در نیکسو" />
          ) : pendingSetup ? (
            <StatusCard
              title="شناسه تأیید شد"
              body="حساب هنوز فعال نیست. پروفایل را کامل کنید."
              href="/setup"
              cta="ادامه ساخت پروفایل"
            />
          ) : (
            <RegisterFlow />
          )}
        </div>
      </main>
    </LoginScene>
  );
}
