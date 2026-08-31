import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { BotStudio } from "@/components/bot-studio";

export default async function BotsSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <BotStudio />;
}
