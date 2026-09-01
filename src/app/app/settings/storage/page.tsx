import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { StorageDesk } from "@/components/storage-desk";

export default async function StoragePage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <StorageDesk />;
}
