import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { BusinessDesk } from "@/components/business-desk";

export default async function BusinessSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <BusinessDesk />;
}
