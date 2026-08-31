"use client";

import { DEFAULT_AVATAR_SVG, svgDataUri } from "@/lib/default-avatar";
import type { PhotoValue } from "@/components/photo-picker";

export function ProfilePreviewCard({
  firstName,
  lastName,
  username,
  bio,
  photo,
}: {
  firstName: string;
  lastName: string;
  username: string;
  bio: string;
  photo: PhotoValue;
}) {
  const src =
    photo.kind === "upload"
      ? photo.dataUrl
      : photo.kind === "catalog"
        ? photo.previewUrl
        : svgDataUri(DEFAULT_AVATAR_SVG);
  const name = [firstName, lastName].filter(Boolean).join(" ") || "بدون نام";

  return (
    <div className="rounded-3xl border border-white/10 bg-black/25 p-5 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="mx-auto size-28 rounded-[2rem] object-cover ring-2 ring-amber-300/50" />
      <p className="mt-4 text-xl font-semibold">{name}</p>
      <p className="mt-1 text-sm text-amber-200" dir="ltr">
        {username ? `@${username}` : "@username"}
      </p>
      {bio ? (
        <p className="mt-3 text-sm leading-7 text-emerald-50/80">{bio}</p>
      ) : (
        <p className="mt-3 text-xs text-emerald-100/40">بیو خالی است</p>
      )}
    </div>
  );
}
