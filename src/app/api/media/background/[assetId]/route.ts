import { NextResponse } from "next/server";
import { requireActiveUser, requireVerifiedUser } from "@/lib/auth";
import { readBackground } from "@/lib/photo-files";

type Ctx = { params: Promise<{ assetId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const me = (await requireActiveUser()) ?? (await requireVerifiedUser());
  if (!me) return new NextResponse("unauthorized", { status: 401 });
  const { assetId } = await ctx.params;
  const file = await readBackground(me.id, assetId);
  if (!file) return new NextResponse("not found", { status: 404 });
  return new NextResponse(new Uint8Array(file), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60" },
  });
}
