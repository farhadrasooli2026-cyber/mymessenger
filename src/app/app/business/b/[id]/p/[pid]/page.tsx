import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { ProductDetail } from "@/components/product-detail";

type Ctx = { params: Promise<{ id: string; pid: string }> };

export default async function ProductPage({ params }: Ctx) {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  const { id, pid } = await params;
  return <ProductDetail businessId={id} productId={pid} />;
}
