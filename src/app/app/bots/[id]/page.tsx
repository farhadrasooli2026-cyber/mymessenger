import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { BotStudio } from "@/components/bot-studio";

export default async function BotDevPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  const { id } = await params;
  return <BotStudio botId={id} />;
}
