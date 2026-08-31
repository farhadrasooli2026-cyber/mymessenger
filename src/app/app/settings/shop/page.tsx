import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { ShopPayDesk } from "@/components/shop-pay-desk";

export default async function ShopSettingsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <ShopPayDesk />;
}
