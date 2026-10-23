import type { FeatureFlagDefinition } from '../definitions'

export const SEALED_WEBHOOK_KEYS_FLAG = 'htpr-7624-sealed-webhook-keys'

export default {
  key: SEALED_WEBHOOK_KEYS_FLAG,
  kind: 'bugfix',
  defaultMode: 'OWNER_AND_QA',
  shippedOn: '2026-10-23',
  description: 'Operational switch for encrypted webhook signing-key writes. Reads always support encrypted and legacy keys; backfill runs only on Everyone.',
  releaseRisk: {
    risk: 'new',
    highRisk: 'access',
    reason: 'Seals newly created or rotated webhook signing keys. This deploy ships read-both support to every web/queue runtime and drain old workers within one deploy, so Owner + QA writes are safe at once; keep this deployment as the rollback floor once any key is sealed. Enable Everyone only after cohort verification; the cron then backfills both tables. Preserve BYOK_CIPHER_SECRET: replacing it strands encrypted keys. Off stops new sealed writes, not decryption.',
  },
} as const satisfies FeatureFlagDefinition
