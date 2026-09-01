import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { FilesSettings } from "@/components/files-settings";

export default async function FilesSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <FilesSettings />;
}
