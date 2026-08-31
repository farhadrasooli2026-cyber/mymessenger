import { redirect } from "next/navigation";
import { requireVerifiedUser } from "@/lib/auth";
import { defaultAppearance } from "@/lib/appearance-types";
import { Messenger } from "@/components/messenger";
import { readSession } from "@/lib/session";

export default async function AppPage() {
  const session = await readSession();
  if (session?.step === "device") redirect("/device");
  const user = await requireVerifiedUser();
  if (!user) redirect("/");
  if (user.status !== "active") redirect("/setup");
  return (
    <Messenger
      userId={user.id}
      displayName={user.displayName}
      identifierMasked={user.identifierMasked ?? ""}
      username={user.username}
      photoUrl={user.photoUrl}
      bio={user.bio}
      appearance={user.appearance ?? defaultAppearance()}
    />
  );
}
