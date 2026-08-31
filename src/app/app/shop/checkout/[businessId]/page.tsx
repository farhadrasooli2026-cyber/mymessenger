import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { CheckoutFlow } from "@/components/checkout-flow";

type Ctx = { params: Promise<{ businessId: string }> };

export default async function CheckoutPage({ params }: Ctx) {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  const { businessId } = await params;
  return <CheckoutFlow businessId={businessId} />;
}
