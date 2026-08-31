import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { GalleryPane } from "@/components/gallery-pane";

export default async function GalleryPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <GalleryPane />;
}
