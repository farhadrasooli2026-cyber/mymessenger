import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { WalletDesk } from "@/components/wallet-desk";

export default async function WalletPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <WalletDesk />;
}
