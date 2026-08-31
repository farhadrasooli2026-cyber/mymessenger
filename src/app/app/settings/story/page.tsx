import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { StorySettings } from "@/components/story-settings";

export default async function StoryPrivacyPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <StorySettings />;
}
