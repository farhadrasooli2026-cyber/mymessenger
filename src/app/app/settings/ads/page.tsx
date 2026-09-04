import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { AdPrefsDesk } from "@/components/ad-prefs-desk";

export default async function AdsSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return (
    <main className="min-h-dvh bg-[#071614] text-emerald-50">
      <AdPrefsDesk />
    </main>
  );
}
