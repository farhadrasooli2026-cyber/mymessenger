import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { LiveSettings } from "@/components/live-settings";

export default async function LiveSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <LiveSettings />;
}
