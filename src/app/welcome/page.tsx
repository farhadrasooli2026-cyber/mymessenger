import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserById, publicUser } from "@/lib/registration";
import { readSession } from "@/lib/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function WelcomePage() {
  const session = await readSession();
  if (!session?.userId || session.step !== "complete") {
    redirect("/");
  }
  const user = await getUserById(session.userId);
  if (!user || user.status !== "active") {
    redirect("/");
  }
  const view = publicUser(user);

  return (
    <div className="min-h-dvh bg-[#071614] px-4 py-16 text-white">
      <div className="mx-auto w-full max-w-lg">
        <Card className="border-white/10 bg-[#0f2f2c]/85 text-white shadow-2xl">
          <CardHeader>
            <CardTitle className="text-2xl">حساب شما فعال شد</CardTitle>
            <CardDescription className="text-emerald-50/75">
              تأیید کد در سرور انجام شد و وضعیت حساب از حالت معلق به فعال تغییر کرد.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-xl bg-black/25 p-4">
              <p className="text-emerald-100/60">نام نمایشی</p>
              <p className="mt-1 text-lg font-medium">{view.displayName}</p>
            </div>
            <div className="rounded-xl bg-black/25 p-4">
              <p className="text-emerald-100/60">شناسه تأییدشده</p>
              <p className="mt-1 font-medium" dir="ltr">
                {view.identifierMasked}
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-amber-300 text-sm font-medium text-[#102824] hover:bg-amber-200"
            >
              بازگشت به ثبت‌نام
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
