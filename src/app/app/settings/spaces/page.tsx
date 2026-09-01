import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { SpacesDesk } from "@/components/spaces-desk";

export default async function SpacesSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <SpacesDesk />;
}
