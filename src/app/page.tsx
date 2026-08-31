import { requireActiveUser } from "@/lib/auth";
import { Landing } from "@/components/landing";

export default async function HomePage() {
  const user = await requireActiveUser();
  return <Landing signedIn={Boolean(user)} />;
}
