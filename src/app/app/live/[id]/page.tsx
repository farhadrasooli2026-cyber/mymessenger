import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { LiveStage } from "@/components/live-stage";

export default async function LiveRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  const { id } = await params;
  const q = await searchParams;
  return <LiveStage liveId={id} invite={q.invite} />;
}
