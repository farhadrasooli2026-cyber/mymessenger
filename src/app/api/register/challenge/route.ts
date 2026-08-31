import { issueHumanChallenge } from "@/lib/registration";
import { json } from "@/lib/http";
import { clientIpHash } from "@/lib/session";

export async function GET() {
  const ipHash = await clientIpHash();
  const challenge = await issueHumanChallenge(ipHash);
  return json({ ok: true, token: challenge.token });
}
