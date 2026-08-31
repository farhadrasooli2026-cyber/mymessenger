import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { BusinessCreate } from "@/components/business-create";

export default async function CreateBusinessPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <BusinessCreate />;
}
