import { requireActiveUser, requirePendingProfile } from "@/lib/auth";
import { Landing } from "@/components/landing";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireActiveUser();
  const pending = await requirePendingProfile();
  return <Landing signedIn={Boolean(user)} pendingSetup={Boolean(pending)} />;
}
