import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { PeopleProfile } from "@/components/people-profile";

export default async function UserProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  const { username } = await params;
  return <PeopleProfile username={username} />;
}
