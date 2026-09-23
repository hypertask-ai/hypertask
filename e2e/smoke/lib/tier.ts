// Which account this run is using. Unset (undefined) means "no journeys" ,
// prod-health.yml and the plain HT_QA_ACCOUNT_STATE_PATH runner flow never
// set this, so the write journeys and demo test skip themselves there and
// only the original 8 read-only view checks run.
//
// The owner named the three accounts "free", "light" and "premium" plans.
// This codebase's real plan identifiers (src/lib/planFromStripePriceId.ts,
// StorePlanKind) are "Free" | "BYOK" | "Pro", there is no "light" plan.
// HT_QA_TIER stays a free-form label (used only for test ids / ticket
// titles, never compared against the app's plan names) until that mapping
// is confirmed; see the PR description's open questions.
export function readTier(): string | undefined {
  return process.env.HT_QA_TIER || undefined
}

// The plan name/label this tier's account is expected to see in
// /settings/billing, e.g. "Free", "BYOK", "Pro" (src/lib/subscriptionPlans.ts
// `storeSubscriptionPlans[].name`, or the shorter StorePlanKind shown in
// BillingSection.tsx's "Plan" row). Left unset until the owner confirms the
// tier-to-plan mapping, the plan-check journey skips itself with a clear
// reason when this isn't set, rather than asserting a guessed value.
export function readExpectedPlanLabel(): string | undefined {
  return process.env.HT_QA_EXPECTED_PLAN || undefined
}

// Prefixes a stable test id with the tier so dedup/tickets stay separate
// per account (e.g. "premium:create-task" vs "free:create-task"). Tierless
// when no tier is set (plain `state.json` / single-account runs, and the
// demo journey which never uses an account).
export function tieredId(id: string): string {
  const tier = readTier()
  return tier ? `${tier}:${id}` : id
}
