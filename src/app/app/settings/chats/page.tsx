import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { ChatOrgSettings } from "@/components/chat-org-settings";

export default async function ChatOrgPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <ChatOrgSettings />;
}
