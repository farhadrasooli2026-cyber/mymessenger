import { json, jsonError } from "@/lib/http";
import { completeProfile, profileInputSchema } from "@/lib/profile";
import { readSession, writeSession } from "@/lib/session";

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

  await writeSession({
    step: "complete",
    challengeId: session.challengeId,
    userId: session.userId,
  });

  return json({ ok: true, next: "/app", user: result.user });
}
