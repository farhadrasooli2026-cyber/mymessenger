import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { BusinessProfile } from "@/components/business-profile";

type Ctx = { params: Promise<{ id: string }> };

export default async function BusinessProfilePage({ params }: Ctx) {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  const { id } = await params;
  return <BusinessProfile id={id} />;
}
