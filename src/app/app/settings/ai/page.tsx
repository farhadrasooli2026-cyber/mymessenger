import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { AiSettings } from "@/components/ai-settings";

export default async function AiSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <AiSettings />;
}
