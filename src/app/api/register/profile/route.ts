import { json, jsonError } from "@/lib/http";
import { completeProfile, profileInputSchema } from "@/lib/profile";
import { appearanceSchema, updateAppearance } from "@/lib/appearance";
import { establishCompleteSession, readSession } from "@/lib/session";

export async function POST(request: Request) {
  const session = await readSession();
  if (!session || session.step !== "profile" || !session.userId) {
    return jsonError("بدون تأیید کد امکان تکمیل پروفایل وجود ندارد.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("درخواست نامعتبر است.");
  }
  const parsed = profileInputSchema.safeParse(body);
  if (!parsed.success) return jsonError("اطلاعات پروفایل کامل یا معتبر نیست.");

  const result = await completeProfile(session.userId, parsed.data);
  if (!result.ok) return jsonError(result.error, result.status);

  const bg = appearanceSchema.pick({ appBackground: true }).safeParse(body);
  if (bg.success && bg.data.appBackground) {
    await updateAppearance(session.userId, { appBackground: bg.data.appBackground });
  }

  await establishCompleteSession({
    userId: session.userId,
    challengeId: session.challengeId,
  });

  return json({ ok: true, next: "/app", user: result.user });
}
