import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { MusicLibrary } from "@/components/music-library";

export default async function MusicPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <MusicLibrary />;
}
