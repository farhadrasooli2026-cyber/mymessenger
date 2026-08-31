import "server-only";
import { getUserById } from "@/lib/registration";
import { publicProfile } from "@/lib/profile";
import { readSession } from "@/lib/session";

export async function requireVerifiedUser() {
  const session = await readSession();
  if (!session?.userId) return null;
  if (session.step !== "profile" && session.step !== "complete") return null;
  const user = await getUserById(session.userId);
  if (!user || !user.verifiedAt) return null;
  return publicProfile(user, user.id);
}

export async function requireActiveUser() {
  const session = await readSession();
  if (!session?.userId || session.step !== "complete") return null;
  const user = await getUserById(session.userId);
  if (!user || user.status !== "active") return null;
  return publicProfile(user, user.id);
}

export async function requireActiveSession() {
  const session = await readSession();
  if (!session?.userId || session.step !== "complete") return null;
  const user = await getUserById(session.userId);
  if (!user || user.status !== "active") return null;
  return { user, session, profile: publicProfile(user, user.id) };
}

export async function requireTwoStepPending() {
  const session = await readSession();
  if (!session?.userId || session.step !== "twostep") return null;
  const user = await getUserById(session.userId);
  if (!user) return null;
  return { user, session };
}

export async function requirePendingProfile() {
  const session = await readSession();
  if (!session?.userId || session.step !== "profile") return null;
  const user = await getUserById(session.userId);
  if (!user || user.status === "active") return null;
  return { user: publicProfile(user, user.id), session };
}
