import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { AudioSettings } from "@/components/audio-settings";

export default async function AudioSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <AudioSettings />;
}
