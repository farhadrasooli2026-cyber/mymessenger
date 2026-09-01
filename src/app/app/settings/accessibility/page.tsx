import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { AccessibilitySettings } from "@/components/accessibility-settings";

export default async function AccessibilityPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <AccessibilitySettings />;
}
