import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "@/lib/config";
import { signPayload, verifyPayload } from "@/lib/crypto-utils";

export async function isAdmin() {
  const jar = await cookies();
  const token = jar.get(config.adminCookie)?.value;
  if (!token) return false;
  const payload = verifyPayload<{ role: string; exp: number }>(token);
  return Boolean(payload && payload.role === "admin" && payload.exp > Date.now());
}

export async function grantAdmin() {
  const jar = await cookies();
  jar.set(
    config.adminCookie,
    signPayload({ role: "admin", exp: Date.now() + 12 * 60 * 60 * 1000 }),
    { httpOnly: true, sameSite: "lax", path: "/", maxAge: 12 * 60 * 60 },
  );
}

export async function requireAdminPage() {
  if (!(await isAdmin())) redirect("/admin/avatars");
}
