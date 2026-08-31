import "server-only";
import { getUserById, publicUser } from "@/lib/registration";
import { readSession } from "@/lib/session";

export async function requireActiveUser() {
  const session = await readSession();
  if (!session?.userId || session.step !== "complete") return null;
  const user = await getUserById(session.userId);
  if (!user || user.status !== "active") return null;
  return publicUser(user);
}
