import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { ProfileSettings } from "@/components/profile-settings";

export default async function SettingsProfilePage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return (
    <ProfileSettings
      initial={{
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        bio: user.bio,
        photoUrl: user.photoUrl,
        photoKind: user.photoKind,
      }}
    />
  );
}
