import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { StickerSettings } from "@/components/sticker-settings";

export default async function StickersCenterPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <StickerSettings />;
}
