import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { BusinessChat } from "@/components/business-chat";

type Ctx = { params: Promise<{ id: string }> };

export default async function BusinessChatPage({ params }: Ctx) {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  const { id } = await params;
  return <BusinessChat businessId={id} />;
}
