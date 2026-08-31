import { redirect } from "next/navigation";
import { requirePendingProfile, requireActiveUser } from "@/lib/auth";
import { ProfileSetup } from "@/components/profile-setup";

export default async function SetupPage() {
  const active = await requireActiveUser();
  if (active) redirect("/app");
  const pending = await requirePendingProfile();
  if (!pending) redirect("/");
  return <ProfileSetup />;
}
