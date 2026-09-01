import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { LockSettings } from "@/components/lock-settings";

export default async function LockPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <LockSettings />;
}
