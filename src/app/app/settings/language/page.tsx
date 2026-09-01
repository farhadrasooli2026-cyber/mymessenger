import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { LanguageSettings } from "@/components/language-settings";

export default async function LanguagePage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <LanguageSettings />;
}
