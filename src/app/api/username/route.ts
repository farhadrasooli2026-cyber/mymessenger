import { json, jsonError } from "@/lib/http";
import { requireActiveUser, requireVerifiedUser } from "@/lib/auth";
import { checkUsername } from "@/lib/profile";

export async function GET(request: Request) {
  const me = (await requireVerifiedUser()) ?? (await requireActiveUser());
  if (!me) return jsonError("نشست معتبر نیست.", 401);
  const url = new URL(request.url);
  const q = url.searchParams.get("u") ?? "";
  const result = await checkUsername(q, me.id);
  return json(result);
}
