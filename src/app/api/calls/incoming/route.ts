import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { startIncomingDemo } from "@/lib/calls";

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as { kind?: string } | null;
  const kind = body?.kind === "video" ? "video" : "voice";
  const result = await startIncomingDemo(user.id, kind);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, call: result.call });
}
