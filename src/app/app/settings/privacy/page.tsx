import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { PrivacyDashboard } from "@/components/privacy-dashboard";

export default async function PrivacyPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <PrivacyDashboard />;
}
