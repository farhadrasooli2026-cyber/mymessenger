import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { AccountSettings } from "@/components/account-settings";

export default async function AccountPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <AccountSettings />;
}
