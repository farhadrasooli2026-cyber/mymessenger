import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { directoryMiniApps, miniInitPayload, nixoPayStub, setMiniProfileGrant } from "@/lib/bots";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const miniId = url.searchParams.get("id");
  if (miniId) {
    const result = await miniInitPayload(user.id, miniId);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  const category = url.searchParams.get("category") ?? "";
  const miniApps = await directoryMiniApps(category || undefined);
  return json({ ok: true, miniApps });
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  if (body.action === "grant") {
    const result = await setMiniProfileGrant(user.id, String(body.miniId ?? ""), body.allow === true);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body.action === "pay") {
    const pay = await nixoPayStub();
    return jsonError(pay.error, pay.status);
  }
  return jsonError("عملیات ناشناخته است.");
}
