export const NIXO_LOGO = "/Nixo-logo.png";

export const PUBLIC_AVATARS = [
  { id: "avatar-1", path: "/avatars/avatar-1.jpg", fa: "آواتار ۱", kind: "user" as const },
  { id: "avatar-2", path: "/avatars/avatar-2.jpg", fa: "آواتار ۲", kind: "user" as const },
  { id: "boy-1", path: "/avatars/boy-1.jpg", fa: "پسر ۱", kind: "user" as const },
  { id: "boy-2", path: "/avatars/boy-2.jpg", fa: "پسر ۲", kind: "user" as const },
  { id: "girl-1", path: "/avatars/girl-1.jpg", fa: "دختر ۱", kind: "user" as const },
  { id: "girl-2", path: "/avatars/girl-2.jpg", fa: "دختر ۲", kind: "user" as const },
  { id: "group-1", path: "/avatars/group-1.jpg", fa: "گروه ۱", kind: "group" as const },
  { id: "group-2", path: "/avatars/group-2.jpg", fa: "گروه ۲", kind: "group" as const },
] as const;

export const PUBLIC_BACKGROUNDS = [
  { id: "bg-1", path: "/backgrounds/bg-1.jpg", fa: "زمرد شب" },
  { id: "bg-2", path: "/backgrounds/bg-2.jpg", fa: "آبی عمیق" },
  { id: "bg-3", path: "/backgrounds/bg-3.png", fa: "بنفش" },
  { id: "bg-4", path: "/backgrounds/bg-4.jpg", fa: "کهربا" },
  { id: "bg-5", path: "/backgrounds/bg-5.jpg", fa: "فیروزه" },
] as const;

export const PUBLIC_WALLPAPERS = [
  { id: "aurora", path: "/wallpapers/aurora.svg", fa: "شفق" },
  { id: "dusk", path: "/wallpapers/dusk.svg", fa: "غروب" },
  { id: "mist", path: "/wallpapers/mist.svg", fa: "مه" },
  { id: "nixo-grid", path: "/wallpapers/nixo-grid.svg", fa: "شبکه نیکسو" },
] as const;

export const PUBLIC_CHAT_BACKGROUNDS = [...PUBLIC_BACKGROUNDS, ...PUBLIC_WALLPAPERS] as const;

export function isPublicAvatarPath(path: string | undefined | null): path is string {
  return Boolean(path && PUBLIC_AVATARS.some((a) => a.path === path));
}

export function isPublicBackgroundPath(path: string | undefined | null): path is string {
  return Boolean(path && PUBLIC_CHAT_BACKGROUNDS.some((b) => b.path === path));
}

export function publicAvatarFor(seed: string, kind: "user" | "group" = "user"): string {
  const list = PUBLIC_AVATARS.filter((a) => (kind === "group" ? a.kind === "group" : a.kind === "user"));
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0;
  return (list[h % list.length] ?? PUBLIC_AVATARS[0]!).path;
}
