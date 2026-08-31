import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { Messenger } from "@/components/messenger";

export default async function AppPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return (
    <Messenger
      displayName={user.displayName ?? "کاربر نیکسو"}
      identifierMasked={user.identifierMasked}
    />
  );
}
