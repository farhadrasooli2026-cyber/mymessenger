import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { getAppearance } from "@/lib/appearance";
import { AppearanceSettings } from "@/components/appearance-settings";

export default async function ChatAppearancePage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  const appearance = await getAppearance(user.id);
  return <AppearanceSettings initial={appearance} mode="chat" />;
}
