import { json } from "@/lib/http";
import { getUserById, publicUser } from "@/lib/registration";
import { readSession } from "@/lib/session";

export async function GET() {
  const session = await readSession();
  if (!session) {
    return json({ ok: true, step: "start" });
  }
  const user = session.userId ? await getUserById(session.userId) : null;
  return json({
    ok: true,
    step: session.step,
    user: user ? publicUser(user) : null,
  });
}
