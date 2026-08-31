import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { DevicesDashboard } from "@/components/devices-dashboard";

export default async function DevicesPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <DevicesDashboard />;
}
