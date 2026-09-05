import { redirect } from "next/navigation";
import { requireVerifiedUser } from "@/lib/auth";
import { mergeAppearance } from "@/lib/appearance-types";
import { Messenger } from "@/components/messenger";
import { readSession } from "@/lib/session";
import { loginBlocked } from "@/lib/account-gate";

export default async function AppPage() {
  const session = await readSession();
  if (session?.step === "device") redirect("/device");
  const user = await requireVerifiedUser();
  if (!user) redirect("/");
  if (user.status !== "active") redirect("/setup");
  if (loginBlocked(user).blocked) redirect("/app/settings/appeals");
  return (
    <Messenger
      userId={user.id}
      displayName={user.displayName}
      identifierMasked={user.identifierMasked ?? ""}
      username={user.username}
      photoUrl={user.photoUrl}
      bio={user.bio}
      appearance={mergeAppearance(user.appearance)}
    />
  );
}
