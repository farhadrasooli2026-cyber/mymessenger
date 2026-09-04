import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { NixoFeaturesDesk } from "@/components/nixo-features-desk";

export default async function NixoFeaturesPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <NixoFeaturesDesk />;
}
