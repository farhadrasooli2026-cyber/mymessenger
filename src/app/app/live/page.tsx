import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { LiveDesk } from "@/components/live-desk";

export default async function LivePage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <LiveDesk />;
}
