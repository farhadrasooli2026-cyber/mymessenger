import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { acceptInvite, previewInvite } from "@/lib/contacts";

export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const result = await previewInvite(token);
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}

export async function POST(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const { token } = await ctx.params;
  const result = await acceptInvite(user.id, token);
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}
