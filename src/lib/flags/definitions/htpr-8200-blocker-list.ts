import type { FeatureFlagDefinition } from '../definitions'

export const HTPR_8200_BLOCKER_LIST_FLAG = 'htpr-8200-blocker-list'

export default {
  key: HTPR_8200_BLOCKER_LIST_FLAG,
  kind: 'feature',
  defaultMode: 'EVERYONE',
  shippedOn: '2026-11-04',
  description: 'List accessible tickets waiting on a person, with their marked question and answer state.',
  releaseRisk: { risk: 'small', reason: 'Read-only listing uses existing board access and can be disabled independently.' },
} as const satisfies FeatureFlagDefinition
