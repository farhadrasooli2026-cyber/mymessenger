import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { DataDesk } from "@/components/data-desk";

export default async function DataSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <DataDesk />;
}
