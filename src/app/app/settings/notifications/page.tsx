import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { NotifySettings } from "@/components/notify-settings";

export default async function NotificationsSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <NotifySettings />;
}
