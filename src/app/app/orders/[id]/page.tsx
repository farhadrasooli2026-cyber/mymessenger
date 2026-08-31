import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { OrderReceipt } from "@/components/order-receipt";

type Ctx = { params: Promise<{ id: string }> };

export default async function OrderPage({ params }: Ctx) {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  const { id } = await params;
  return (
    <Suspense fallback={<main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">بارگذاری رسید…</main>}>
      <OrderReceipt orderId={id} />
    </Suspense>
  );
}
