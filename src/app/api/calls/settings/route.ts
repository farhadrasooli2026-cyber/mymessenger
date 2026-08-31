import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { updateCallSettings } from "@/lib/calls";

export async function PATCH(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("درخواست نامعتبر است.");
  const callPrivacy =
    body.callPrivacy === "everyone" ||
    body.callPrivacy === "contacts" ||
    body.callPrivacy === "nobody" ||
    body.callPrivacy === "selected"
      ? body.callPrivacy
      : undefined;
  const result = await updateCallSettings(user.id, {
    callPrivacy,
    callAllowIds: Array.isArray(body.callAllowIds) ? body.callAllowIds.map(String) : undefined,
    hideCallOnLockScreen: typeof body.hideCallOnLockScreen === "boolean" ? body.hideCallOnLockScreen : undefined,
    lowDataCalls: typeof body.lowDataCalls === "boolean" ? body.lowDataCalls : undefined,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({
    ok: true,
    callPrivacy: result.callPrivacy,
    hideCallOnLockScreen: result.hideCallOnLockScreen,
    lowDataCalls: result.lowDataCalls,
  });
}
