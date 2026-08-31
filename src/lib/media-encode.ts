export async function compressImage(file: Blob, quality: "compressed" | "standard" | "high" | "original"): Promise<Blob> {
  if (quality === "original" || !file.type.startsWith("image/")) return file;
  const { max, quality: q } = quality === "compressed"
    ? { max: 960, quality: 0.52 }
    : quality === "standard"
      ? { max: 1440, quality: 0.74 }
      : { max: 1920, quality: 0.88 };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
  return blob ?? file;
}

export async function fileToBytes(file: Blob): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}
