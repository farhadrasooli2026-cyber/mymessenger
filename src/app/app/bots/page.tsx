import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { BotsHub } from "@/components/bots-hub";

export default async function BotsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <BotsHub />;
}
