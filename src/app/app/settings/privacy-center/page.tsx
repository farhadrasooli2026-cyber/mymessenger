import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { PrivacySecurityCenter } from "@/components/privacy-security-center";

export default async function PrivacyCenterPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <PrivacySecurityCenter />;
}
