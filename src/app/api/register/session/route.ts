import { json } from "@/lib/http";
import { getUserById } from "@/lib/registration";
import { publicProfile } from "@/lib/profile";
import { readSession } from "@/lib/session";
import { isDemoInboxEnabled } from "@/lib/env-config";

export async function GET() {
  const session = await readSession();
  if (!session) {
    return json({ ok: true, step: "start", demoInbox: isDemoInboxEnabled() });
  }
  const user = session.userId ? await getUserById(session.userId) : null;
  return json({
    ok: true,
    step: session.step,
    user: user ? publicProfile(user, user.id) : null,
    hasPasskeys: session.step === "twostep" ? (user?.passkeys?.length ?? 0) > 0 : undefined,
    purpose: session.purpose,
    demoInbox: isDemoInboxEnabled(),
  });
}
