import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { MediaSettings } from "@/components/media-settings";

export default async function MediaSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <MediaSettings />;
}
