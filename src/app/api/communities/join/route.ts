import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { joinOpenCommunity } from "@/lib/communities";

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as { communityId?: string; acceptRules?: boolean } | null;
  if (!body?.communityId) return jsonError("انجمن نامعتبر است.");
  const result = await joinOpenCommunity(user.id, body.communityId, { acceptRules: body.acceptRules });
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}
