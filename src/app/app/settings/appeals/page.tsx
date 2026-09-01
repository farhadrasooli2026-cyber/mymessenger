import { redirect } from "next/navigation";
import { requireVerifiedUser } from "@/lib/auth";
import { AppealsDesk } from "@/components/appeals-desk";

export default async function AppealsPage() {
  const user = await requireVerifiedUser();
  if (!user) redirect("/");
  return <AppealsDesk />;
}
