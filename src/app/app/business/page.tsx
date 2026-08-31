import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { BusinessDirectory } from "@/components/business-directory";

export default async function BusinessPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <BusinessDirectory />;
}
