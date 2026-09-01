import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { rejectCardPlain } from "@/lib/shop";
import {
  addTeamMember,
  cancelSubscription,
  changePlan,
  checkoutAndAttach,
  claimReferral,
  confirmSandboxIntent,
  createReferral,
  financeDashboard,
  financeExport,
  financeMutate,
  listPublicPlans,
  myBilling,
  reactivateSubscription,
  requestRefund,
  savePaymentMethod,
  setSeats,
  upsertBillingProfile,
} from "@/lib/billing";

function asJson(result: { ok: boolean; error?: string; status?: number }) {
  if (!result.ok) return jsonError(result.error ?? "خطا", result.status ?? 400);
  return json(result);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "plans";
  if (view === "plans") {
    const user = await requireActiveUser();
    return json(await listPublicPlans(user?.id));
  }
  if (view === "finance") return asJson(await financeDashboard());
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  if (view === "me") return json(await myBilling(user.id));
  return jsonError("view نامعتبر است.");
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  if (body.action === "finance") {
    return asJson(
      await financeMutate({
        action: body.op as "refund.complete" | "refund.reject" | "review.clear" | "coupon.upsert" | "chargeback",
        id: typeof body.id === "string" ? body.id : undefined,
        code: typeof body.code === "string" ? body.code : undefined,
        percent: typeof body.percent === "number" ? body.percent : undefined,
        days: typeof body.days === "number" ? body.days : undefined,
      }),
    );
  }
  if (body.action === "finance_export") return asJson(await financeExport());

  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  if (rejectCardPlain(body)) {
    return jsonError("شماره کارت و CVV در نیکسو ذخیره یا پذیرفته نمی‌شود. فقط توکن درگاه.", 400);
  }
  if (body.action === "checkout") {
    return asJson(
      await checkoutAndAttach(user.id, {
        planId: String(body.planId ?? ""),
        interval: String(body.interval ?? "month"),
        currency: typeof body.currency === "string" ? body.currency : undefined,
        coupon: typeof body.coupon === "string" ? body.coupon : undefined,
        provider: typeof body.provider === "string" ? body.provider : undefined,
        idempotencyKey: String(body.idempotencyKey ?? ""),
        giftToUserId: typeof body.giftToUserId === "string" ? body.giftToUserId : undefined,
        trial: Boolean(body.trial),
        seats: typeof body.seats === "number" ? body.seats : undefined,
      }),
    );
  }
  if (body.action === "confirm") {
    return asJson(
      await confirmSandboxIntent(user.id, String(body.intentId ?? ""), body.outcome === "fail" ? "fail" : "success"),
    );
  }
  if (body.action === "cancel") {
    return asJson(await cancelSubscription(user.id, body.mode === "immediate" ? "immediate" : "period_end"));
  }
  if (body.action === "reactivate") return asJson(await reactivateSubscription(user.id));
  if (body.action === "change") {
    return asJson(await changePlan(user.id, String(body.planId ?? ""), String(body.interval ?? "month"), String(body.idempotencyKey ?? "")));
  }
  if (body.action === "profile") {
    return asJson(
      await upsertBillingProfile(user.id, {
        display: typeof body.display === "string" ? body.display : undefined,
        country: typeof body.country === "string" ? body.country : undefined,
        taxIdMasked: typeof body.taxIdMasked === "string" ? body.taxIdMasked : undefined,
        addressLine: typeof body.addressLine === "string" ? body.addressLine : undefined,
        city: typeof body.city === "string" ? body.city : undefined,
      }),
    );
  }
  if (body.action === "method") {
    return asJson(
      await savePaymentMethod(user.id, {
        tokenRef: String(body.tokenRef ?? ""),
        brand: typeof body.brand === "string" ? body.brand : undefined,
        last4: typeof body.last4 === "string" ? body.last4 : undefined,
        provider: typeof body.provider === "string" ? body.provider : undefined,
      }),
    );
  }
  if (body.action === "seats") return asJson(await setSeats(user.id, Number(body.seats ?? 0)));
  if (body.action === "member") return asJson(await addTeamMember(user.id, String(body.memberId ?? "")));
  if (body.action === "referral") return asJson(await createReferral(user.id));
  if (body.action === "referral_claim") return asJson(await claimReferral(user.id, String(body.code ?? "")));
  if (body.action === "refund_request") {
    return asJson(await requestRefund(user.id, String(body.intentId ?? ""), typeof body.amount === "number" ? body.amount : undefined));
  }
  return jsonError("عمل نامعتبر است.");
}
