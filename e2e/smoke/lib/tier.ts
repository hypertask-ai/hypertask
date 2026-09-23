// Which account this run is using. Unset (undefined) means "no journeys" ,
// prod-health.yml and the plain HT_QA_ACCOUNT_STATE_PATH runner flow never
// set this, so the write journeys and demo test skip themselves there and
// only the original 8 read-only view checks run.
//
// The three QA runner accounts are "free", "byok" and "pro". Confirmed
// mapping to this codebase's real plan identifiers
// (src/lib/planFromStripePriceId.ts, StorePlanKind): free -> "Free",
// byok -> "BYOK", pro -> "Pro". There is no light or premium tier. Free is
// free forever and its AI chat runs on gpt-5.4-mini.
export function readTier(): string | undefined {
  return process.env.HT_QA_TIER || undefined
}

const TIER_TO_PLAN: Record<string, string> = {
  free: 'Free',
  byok: 'BYOK',
  pro: 'Pro',
}

// The plan name/label this tier's account is expected to see in
// /settings/billing, e.g. "Free", "BYOK", "Pro" (src/lib/subscriptionPlans.ts
// `storeSubscriptionPlans[].name`, or the shorter StorePlanKind shown in
// BillingSection.tsx's "Plan" row). Derived from HT_QA_TIER via the
// confirmed mapping above; HT_QA_EXPECTED_PLAN can still override it.
export function readExpectedPlanLabel(): string | undefined {
  const override = process.env.HT_QA_EXPECTED_PLAN
  if (override) return override
  const tier = readTier()
  return tier ? TIER_TO_PLAN[tier] : undefined
}

// Prefixes a stable test id with the tier so dedup/tickets stay separate
// per account (e.g. "pro:create-task" vs "free:create-task"). Tierless
// when no tier is set (plain `state.json` / single-account runs, and the
// demo journey which never uses an account).
export function tieredId(id: string): string {
  const tier = readTier()
  return tier ? `${tier}:${id}` : id
}
