import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { ConnectedBots } from "@/components/connected-bots";

export default async function ConnectedBotsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <ConnectedBots />;
}
