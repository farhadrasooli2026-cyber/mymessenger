import { NextResponse } from "next/server";
import { getCatalogItem } from "@/lib/profile";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const item = await getCatalogItem(id);
  if (!item) return new NextResponse("not found", { status: 404 });
  return new NextResponse(item.svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
