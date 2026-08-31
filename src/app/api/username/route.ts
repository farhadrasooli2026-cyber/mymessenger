import { json, jsonError } from "@/lib/http";
import { requireActiveUser, requireVerifiedUser } from "@/lib/auth";
import { checkUsername } from "@/lib/profile";
import { USERNAME_STATUS_LABEL } from "@/lib/username";

export async function GET(request: Request) {
  const me = (await requireVerifiedUser()) ?? (await requireActiveUser());
  if (!me) return jsonError("نشست معتبر نیست.", 401);
  const url = new URL(request.url);
  const q = url.searchParams.get("u") ?? "";
  const result = await checkUsername(q, me.id);
  if ("status" in result && result.status === 429) return jsonError("بررسی نام کاربری محدود شد.", 429);
  const label =
    result.reason === "free"
      ? USERNAME_STATUS_LABEL.free
      : result.reason === "taken"
        ? USERNAME_STATUS_LABEL.taken
        : USERNAME_STATUS_LABEL.invalid;
  return json({ ...result, label });
}
