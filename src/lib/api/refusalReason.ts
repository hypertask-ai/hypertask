export const REFUSAL_REASON = {
  invalidField: 'invalid_field',
  missingField: 'missing_field',
  unauthorized: 'unauthorized',
  planLimitReached: 'PLAN_LIMIT_REACHED',
  forbidden: 'forbidden',
  notFound: 'not_found',
  payloadTooLarge: 'payload_too_large',
  rateLimited: 'rate_limited',
} as const

export type NamedRefusalReason = (typeof REFUSAL_REASON)[keyof typeof REFUSAL_REASON]

export const NAMED_REFUSAL_REASONS: readonly NamedRefusalReason[] = Object.values(REFUSAL_REASON)
