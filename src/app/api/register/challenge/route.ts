import { issueHumanChallenge } from "@/lib/registration";
import { bindHumanCookie } from "@/lib/human-cookie";
import { json } from "@/lib/http";
import { clientIpHash } from "@/lib/session";

export async function GET() {
  const ipHash = await clientIpHash();
  const challenge = await issueHumanChallenge(ipHash);
  await bindHumanCookie(challenge.token, challenge.issuedAt);
  return json({ ok: true, token: challenge.token });
}
