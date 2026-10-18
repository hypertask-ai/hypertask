import { isGuestUser } from "@/lib/demo/guest";
import { FEATURE_FLAG_OWNER_USER_ID, FEATURE_FLAG_QA_USER_ID } from "@/lib/flags";

export type AccountCategory = "customer" | "internal" | "qa" | "guest" | "probe";

export const PRODUCTION_SMOKE_QA_USER_ID = 2343;
const QA_USER_IDS: ReadonlySet<number> = new Set([FEATURE_FLAG_QA_USER_ID, PRODUCTION_SMOKE_QA_USER_ID]);
const INTERNAL_USER_IDS: ReadonlySet<number> = new Set([FEATURE_FLAG_OWNER_USER_ID]);
const INTERNAL_DOMAIN = "hypertask.ai";
const GUEST_DOMAIN = `demo.${INTERNAL_DOMAIN}`;
const PROBE_DOMAIN = "funnel-probe.hypertask.app";

function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

function isWithinDomain(domain: string, parent: string): boolean {
  return domain === parent || domain.endsWith(`.${parent}`);
}

export function accountCategory(
  user: { id: number; uid?: string | null; email: string },
  { probeDomain = false }: { probeDomain?: boolean } = {},
): AccountCategory {
  const email = user.email.trim().toLowerCase();
  const domain = emailDomain(email);
  if (isGuestUser(user) || isWithinDomain(domain, GUEST_DOMAIN)) return "guest";
  const qaEmail = process.env.QA_LOGIN_EMAIL?.trim().toLowerCase();
  if (QA_USER_IDS.has(user.id) || (qaEmail && email === qaEmail)) return "qa";
  if (probeDomain && isWithinDomain(domain, PROBE_DOMAIN)) return "probe";
  if (INTERNAL_USER_IDS.has(user.id) || isWithinDomain(domain, INTERNAL_DOMAIN)) return "internal";
  return "customer";
}

export function isSyntheticAccount(category: AccountCategory): boolean {
  return category === "qa" || category === "guest";
}
