import { NextResponse } from "next/server";
import { getBgItem } from "@/lib/appearance";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const item = await getBgItem(id);
  if (!item) return new NextResponse("not found", { status: 404 });
  return new NextResponse(item.svg, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
