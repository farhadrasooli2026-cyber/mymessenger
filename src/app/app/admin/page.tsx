import { redirect } from "next/navigation";
import { requireVerifiedUser } from "@/lib/auth";
import { AdminDesk } from "@/components/admin-desk";

export default async function AdminPage() {
  const user = await requireVerifiedUser();
  if (!user) redirect("/");
  return <AdminDesk />;
}
