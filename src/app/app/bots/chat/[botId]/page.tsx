import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { BotChat } from "@/components/bot-chat";

export default async function BotChatPage({ params }: { params: Promise<{ botId: string }> }) {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  const { botId } = await params;
  return <BotChat botId={botId} />;
}
