import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { OrdersList } from "@/components/orders-list";

export default async function OrdersPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <OrdersList />;
}
