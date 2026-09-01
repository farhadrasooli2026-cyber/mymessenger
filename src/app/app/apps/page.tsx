import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { AppsDesk } from "@/components/apps-desk";

export default async function AppsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <AppsDesk />;
}
