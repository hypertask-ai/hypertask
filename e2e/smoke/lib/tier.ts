export function readTier(): string | undefined {
  return process.env.HT_QA_TIER || undefined
}

const TIER_TO_PLAN: Record<string, string> = {
  free: 'Free',
  byok: 'BYOK',
  pro: 'Pro',
}

export function readExpectedPlanLabel(): string | undefined {
  const override = process.env.HT_QA_EXPECTED_PLAN
  if (override) return override
  const tier = readTier()
  return tier ? TIER_TO_PLAN[tier] : undefined
}

export function tieredId(id: string): string {
  const tier = readTier()
  return tier ? `${tier}:${id}` : id
}
