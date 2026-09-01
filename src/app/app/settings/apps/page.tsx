import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { ConnectedApps } from "@/components/connected-apps";

export default async function ConnectedAppsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <ConnectedApps />;
}
