import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { BillingDesk } from "@/components/billing-desk";

export default async function BillingSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <BillingDesk />;
}
