import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { setThreadBackground } from "@/lib/appearance";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  background: z.object({
    kind: z.enum(["default", "catalog", "upload", "solid", "gradient"]),
    catalogId: z.string().optional(),
    assetId: z.string().optional(),
    dataUrl: z.string().optional(),
    color: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    direction: z.string().optional(),
  }),
});

export async function PATCH(request: Request, ctx: Ctx) {
  const me = await requireActiveUser();
  if (!me) return jsonError("نشست فعال نیست.", 401);
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("پس‌زمینه معتبر نیست.");
  const result = await setThreadBackground(me.id, id, parsed.data.background as never);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, background: result.background });
}
