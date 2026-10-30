import type { FeatureFlagDefinition } from '../definitions';

export const HTPR_8218_COMMENT_PIN_STAR_FLAG = 'htpr-8218-comment-pin-star';

export default {
  key: HTPR_8218_COMMENT_PIN_STAR_FLAG,
  kind: 'feature',
  defaultMode: 'EVERYONE',
  shippedOn: '2026-10-30',
  description: 'Agents can pin and star comments.',
} as const satisfies FeatureFlagDefinition;
