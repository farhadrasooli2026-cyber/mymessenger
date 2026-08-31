import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { MiniAppFrame } from "@/components/mini-app-frame";

export default async function MiniPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  const { id } = await params;
  return <MiniAppFrame miniId={id} />;
}
