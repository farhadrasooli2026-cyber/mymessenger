import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { AiDesk } from "@/components/ai-desk";

export default async function AiPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <AiDesk />;
}
