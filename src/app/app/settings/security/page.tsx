import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { SecurityDashboard } from "@/components/security-dashboard";

export default async function SecurityPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <SecurityDashboard />;
}
