import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { ackHumanChallenge } from "@/lib/registration";
import { clientIpHash } from "@/lib/session";

const schema = z.object({ token: z.string().min(8).max(128) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("درخواست نامعتبر است.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("درخواست نامعتبر است.");
  const ipHash = await clientIpHash();
  const result = await ackHumanChallenge(parsed.data.token, ipHash);
  if (!result.ok) return jsonError(result.error);
  return json({ ok: true });
}
