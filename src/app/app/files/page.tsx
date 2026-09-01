import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { FilesDesk } from "@/components/files-desk";

export default async function FilesPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <FilesDesk />;
}
