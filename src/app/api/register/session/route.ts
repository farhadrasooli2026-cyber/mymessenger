import { json } from "@/lib/http";
import { getDeliveredChallenge, getUserById } from "@/lib/registration";
import { publicProfile } from "@/lib/profile";
import { clearSession, readSession } from "@/lib/session";
import { isDemoInboxEnabled } from "@/lib/env-config";

export async function GET() {
  const session = await readSession();
  if (!session) {
    return json({ ok: true, step: "start", demoInbox: isDemoInboxEnabled() });
  }
  if (session.step === "verify") {
    const delivered = await getDeliveredChallenge(session.challengeId);
    if (!delivered) {
      await clearSession();
      return json({ ok: true, step: "start", demoInbox: isDemoInboxEnabled() });
    }
    return json({
      ok: true,
      step: "verify",
      channel: delivered.channel,
      masked: delivered.masked,
      ttlSeconds: delivered.ttlSeconds,
      demoInbox: isDemoInboxEnabled(),
    });
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
