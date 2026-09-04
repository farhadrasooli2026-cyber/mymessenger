import { issueHumanChallenge } from "@/lib/registration";
import { bindHumanCookie } from "@/lib/human-cookie";
import { json, jsonError } from "@/lib/http";
import { clientIpHash } from "@/lib/session";

export async function GET() {
  try {
    const ipHash = await clientIpHash();
    const challenge = await issueHumanChallenge(ipHash);
    await bindHumanCookie(challenge.token, challenge.issuedAt);
    return json({ ok: true, token: challenge.token });
  } catch {
    return jsonError("اتصال به پایگاه داده برقرار نشد. بعداً تلاش کنید.", 503);
  }
}
