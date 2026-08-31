import { NextResponse } from "next/server";
import { getUserById } from "@/lib/registration";
import { publicProfile } from "@/lib/profile";
import { readUserPhoto } from "@/lib/photo-files";
import { requireActiveUser } from "@/lib/auth";
import { DEFAULT_AVATAR_SVG } from "@/lib/default-avatar";

type Ctx = { params: Promise<{ userId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { userId } = await ctx.params;
  const viewer = await requireActiveUser();
  const { readStoreSnapshot } = await import("@/lib/store");
  const snap = await readStoreSnapshot();
  const asBot = (snap.bots ?? []).find((b) => b.id === userId);
  const asBiz = (snap.businesses ?? []).find((b) => b.id === userId);
  const asProduct = (snap.bizProducts ?? []).find((p) => p.id === userId);
  if (asBot || asBiz || asProduct) {
    const file = await readUserPhoto(userId);
    if (!file) {
      return new NextResponse(DEFAULT_AVATAR_SVG, {
        headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
      });
    }
    return new NextResponse(new Uint8Array(file), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60" },
    });
  }
  const owner = await getUserById(userId);
  if (!owner) return new NextResponse("not found", { status: 404 });
  const view = publicProfile(owner, viewer?.id ?? null);
  if (view.photoHidden && viewer?.id !== owner.id) {
    return new NextResponse(DEFAULT_AVATAR_SVG, {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  }
  const file = await readUserPhoto(userId);
  if (!file) {
    return new NextResponse(DEFAULT_AVATAR_SVG, {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  }
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=60",
    },
  });
}
