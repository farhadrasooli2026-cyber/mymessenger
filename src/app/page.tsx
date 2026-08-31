import { RegisterFlow } from "@/components/register-flow";

export default function HomePage() {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#071614] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(52,211,153,0.18),_transparent_42%),radial-gradient(circle_at_bottom_left,_rgba(251,191,36,0.12),_transparent_35%)]" />
      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-amber-300 text-sm font-black text-[#102824]">
            NX
          </div>
          <div>
            <p className="text-lg font-semibold tracking-[0.2em]">NIXO</p>
            <p className="text-xs text-emerald-100/70">ثبت‌نام امن</p>
          </div>
        </div>
        <p className="hidden text-xs text-emerald-100/60 sm:block">تأیید سمت سرور · کد یک‌بارمصرف · ضد سوءاستفاده</p>
      </header>
      <main className="relative z-10 mx-auto grid w-full max-w-5xl gap-8 px-4 pb-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <section className="space-y-6 pt-2">
          <h1 className="max-w-xl text-3xl font-semibold leading-snug sm:text-4xl">
            حساب NIXO فقط بعد از تأیید مالکیت شماره یا ایمیل فعال می‌شود.
          </h1>
          <p className="max-w-lg text-sm leading-7 text-emerald-50/75 sm:text-base">
            کد تأیید هش می‌شود، منقضی می‌شود، و فقط یک‌بار قابل استفاده است. تلاش‌های اشتباه، ارسال مکرر، و ثبت‌نام خودکار محدود شده‌اند. شناسه تأییدنشده هرگز به حساب فعال تبدیل نمی‌شود.
          </p>
          <ul className="grid gap-3 text-sm text-emerald-50/85 sm:grid-cols-2">
            {[
              "ثبت‌نام با موبایل ایران",
              "ثبت‌نام با ایمیل",
              "محدودیت تلاش و ارسال مجدد",
              "پنهان‌سازی وجود حساب",
            ].map((item) => (
              <li key={item} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </section>
        <RegisterFlow />
      </main>
    </div>
  );
}
