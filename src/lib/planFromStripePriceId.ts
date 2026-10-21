import {
  allMonthlyPrices,
  allYearlyPrices,
} from "@/lib/subscriptionPlans";

export type StorePlanKind = "Free" | "BYOK" | "Pro" | "AI";

export type StripeBillingInterval = "month" | "year";

export const STORE_PLAN_RANK: Record<StorePlanKind, number> = {
  Free: 0,
  BYOK: 1,
  AI: 2,
  Pro: 3,
};

const CANONICAL_SEAT_PRICE = {
  month: "price_1QjJeDIhmcH60VcciHzZ3mTJ",
  year: "price_1QjJf8IhmcH60VccNUrF7YJf",
} as const;

const CURRENT_SEAT_PRICE_MONTH = "price_1TMlqDIhmcH60VccRZGW1xK3";

const CUSTOM_DEAL_PRICES = new Set(["price_1QCKkpIhmcH60Vcc2RqVACTc"]);

export function planKindFromStripePriceId(priceId: string | null | undefined): {
  storePlanId: StorePlanKind;
  billingInterval: StripeBillingInterval | null;
} {
  if (!priceId) {
    return { storePlanId: "Free", billingInterval: null };
  }

  if (priceId === CANONICAL_SEAT_PRICE.month || priceId === CURRENT_SEAT_PRICE_MONTH) {
    return { storePlanId: "Pro", billingInterval: "month" };
  }
  if (priceId === CANONICAL_SEAT_PRICE.year) {
    return { storePlanId: "Pro", billingInterval: "year" };
  }
  if (CUSTOM_DEAL_PRICES.has(priceId)) {
    return { storePlanId: "Pro", billingInterval: "month" };
  }

  const mi = allMonthlyPrices.indexOf(priceId);
  if (mi !== -1) {
    if (mi <= 1) return { storePlanId: "AI", billingInterval: "month" };
    if (mi === 2) return { storePlanId: "BYOK", billingInterval: "month" };
    if (mi === 3) return { storePlanId: "Pro", billingInterval: "month" };
  }

  const yi = allYearlyPrices.indexOf(priceId);
  if (yi !== -1) {
    if (yi <= 1) return { storePlanId: "AI", billingInterval: "year" };
    if (yi === 2) return { storePlanId: "BYOK", billingInterval: "year" };
    if (yi === 3) return { storePlanId: "Pro", billingInterval: "year" };
  }

  return { storePlanId: "Free", billingInterval: null };
}
