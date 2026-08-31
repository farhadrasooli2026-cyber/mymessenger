import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { getPeerPublicKey, savePublicKey } from "@/lib/safety";

const schema = z.object({
  publicKey: z.object({
    kty: z.string(),
    crv: z.string().optional(),
    x: z.string().optional(),
    y: z.string().optional(),
    ext: z.boolean().optional(),
    key_ops: z.array(z.string()).optional(),
  }),
});

export async function PUT(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("کلید عمومی معتبر نیست.");
  const result = await savePublicKey(user.id, parsed.data.publicKey);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true });
}

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const peerKey = new URL(request.url).searchParams.get("peerKey") ?? "";
  if (!peerKey) {
    return json({ ok: true, publicKey: user.cryptoPublicKey ?? null });
  }
  const result = await getPeerPublicKey(user.id, peerKey);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, publicKey: result.publicKey });
}
