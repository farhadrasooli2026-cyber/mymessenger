import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { CallCenterDesk } from "@/components/call-center-desk";

export default async function CallsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <CallCenterDesk />;
}
