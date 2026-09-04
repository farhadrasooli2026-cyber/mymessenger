import "server-only";
import { z } from "zod";
import { defaultAppearance } from "@/lib/appearance-types";
import type { Appearance, BackgroundSpec } from "@/lib/appearance-types";
import { randomId } from "@/lib/crypto-utils";
import { decodeDataUrl, saveBackground } from "@/lib/photo-files";
import { mutateStore, readStoreSnapshot } from "@/lib/store";

const backgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default") }),
  z.object({ kind: z.literal("catalog"), catalogId: z.string().min(4) }),
  z.object({ kind: z.literal("public"), path: z.string().startsWith("/wallpapers/") }),
  z.object({ kind: z.literal("upload"), assetId: z.string().optional(), dataUrl: z.string().max(1_400_000).optional() }),
  z.object({ kind: z.literal("solid"), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({
    kind: z.literal("gradient"),
    from: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    to: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    direction: z.enum(["to bottom", "to top", "to left", "to right", "to bottom right", "to bottom left"]),
  }),
]);

export const appearanceSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  customTheme: z
    .object({
      main: z.string(),
      secondary: z.string(),
      bubble: z.string(),
      bubbleText: z.string(),
      background: z.string(),
      text: z.string(),
      accent: z.string(),
    })
    .nullable()
    .optional(),
  textSize: z.enum(["small", "medium", "large", "xl"]).optional(),
  bubbleStyle: z.enum(["classic", "rounded", "minimal", "compact"]).optional(),
  appBackground: backgroundSchema.optional(),
  chatBackground: backgroundSchema.optional(),
  syncAppearance: z.boolean().optional(),
});

async function persistBg(userId: string, spec: BackgroundSpec & { dataUrl?: string }): Promise<BackgroundSpec> {
  if (spec.kind === "upload" && spec.dataUrl) {
    const buf = decodeDataUrl(spec.dataUrl);
    if (!buf) throw new Error("invalid");
    const assetId = await saveBackground(userId, buf);
    return { kind: "upload", assetId };
  }
  if (spec.kind === "upload") {
    if (!spec.assetId) return { kind: "default" };
    return { kind: "upload", assetId: spec.assetId };
  }
  return spec;
}

export async function getAppearance(userId: string): Promise<Appearance> {
  const data = await readStoreSnapshot();
  const user = data.users.find((u) => u.id === userId);
  return user?.appearance ?? defaultAppearance();
}

export async function updateAppearance(userId: string, patch: z.infer<typeof appearanceSchema>) {
  let appBackground = patch.appBackground;
  let chatBackground = patch.chatBackground;
  try {
    if (appBackground) appBackground = await persistBg(userId, appBackground);
    if (chatBackground) chatBackground = await persistBg(userId, chatBackground);
  } catch {
    return { ok: false as const, status: 400, error: "فایل پس‌زمینه معتبر نیست." };
  }

  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, status: 401, error: "نشست معتبر نیست." };
    const current = user.appearance ?? defaultAppearance();
    if (appBackground?.kind === "catalog" && !data.bgItems.some((i) => i.id === appBackground.catalogId)) {
      return { ok: false as const, status: 400, error: "پس‌زمینه آماده یافت نشد." };
    }
    if (chatBackground?.kind === "catalog" && !data.bgItems.some((i) => i.id === chatBackground.catalogId)) {
      return { ok: false as const, status: 400, error: "پس‌زمینه آماده یافت نشد." };
    }
    user.appearance = {
      ...current,
      ...patch,
      appBackground: appBackground ?? current.appBackground,
      chatBackground: chatBackground ?? current.chatBackground,
      customTheme: patch.customTheme === undefined ? current.customTheme : patch.customTheme,
    };
    return { ok: true as const, appearance: user.appearance };
  });
}

export async function resetAppearance(userId: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, status: 401, error: "نشست معتبر نیست." };
    user.appearance = defaultAppearance();
    for (const thread of data.threads) {
      if (thread.ownerUserId === userId) delete thread.background;
    }
    return { ok: true as const, appearance: user.appearance };
  });
}

export async function setThreadBackground(userId: string, threadId: string, spec: BackgroundSpec & { dataUrl?: string }) {
  let saved: BackgroundSpec;
  try {
    saved = await persistBg(userId, spec);
  } catch {
    return { ok: false as const, status: 400, error: "فایل پس‌زمینه معتبر نیست." };
  }
  return mutateStore((data) => {
    const thread = data.threads.find((t) => t.id === threadId && t.ownerUserId === userId);
    if (!thread) return { ok: false as const, status: 404, error: "گفتگو یافت نشد." };
    if (saved.kind === "catalog" && !data.bgItems.some((i) => i.id === saved.catalogId)) {
      return { ok: false as const, status: 400, error: "پس‌زمینه آماده یافت نشد." };
    }
    thread.background = saved;
    return { ok: true as const, background: saved };
  });
}

export async function listBgCatalog() {
  const data = await readStoreSnapshot();
  return {
    categories: [...data.bgCategories].sort((a, b) => a.sort - b.sort),
    items: [...data.bgItems].sort((a, b) => a.sort - b.sort),
  };
}

export async function getBgItem(id: string) {
  const data = await readStoreSnapshot();
  return data.bgItems.find((i) => i.id === id) ?? null;
}

export async function adminAddBgCategory(en: string, fa: string) {
  return mutateStore((data) => {
    const id = randomId().slice(0, 8);
    const sort = data.bgCategories.reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    const category = { id, en, fa, sort };
    data.bgCategories.push(category);
    return { ok: true as const, category };
  });
}

export async function adminAddBgItem(categoryId: string, title: string, svg: string) {
  return mutateStore((data) => {
    if (!data.bgCategories.some((c) => c.id === categoryId)) {
      return { ok: false as const, error: "دسته‌بندی یافت نشد." };
    }
    const now = Date.now();
    const item = {
      id: randomId(),
      categoryId,
      title,
      svg,
      sort: data.bgItems.filter((i) => i.categoryId === categoryId).length + 1,
      createdAt: now,
      updatedAt: now,
    };
    data.bgItems.push(item);
    return { ok: true as const, item };
  });
}

export async function adminDeleteBgItem(id: string) {
  return mutateStore((data) => {
    data.bgItems = data.bgItems.filter((i) => i.id !== id);
    return { ok: true as const };
  });
}
