import { NextResponse } from 'next/server'
import { buildFieldError, type McpAllowedValue } from '@/lib/mcp/fieldError'
import { isPlanLimitReachedError, type PlanLimitReachedError } from '@/lib/planLimits'
import { REFUSAL_REASON } from './refusalReason'

type PlanLimit = PlanLimitReachedError['limit']

export type ForwardedRefusalStatus = 400 | 401 | 402 | 403 | 404 | 405 | 409 | 410 | 413 | 415 | 422 | 429

export type Refusal =
  | { status: 400; reason: typeof REFUSAL_REASON.invalidField | typeof REFUSAL_REASON.missingField; field: string; message: string; allowedValues?: readonly McpAllowedValue[] }
  | { status: 401; reason: typeof REFUSAL_REASON.unauthorized; field?: string; message: string }
  | { status: 402; reason: typeof REFUSAL_REASON.planLimitReached; limit: PlanLimit; max: number; message: string }
  | { status: 403; reason: typeof REFUSAL_REASON.forbidden; field?: string; message: string }
  | { status: 404; reason: typeof REFUSAL_REASON.notFound; field?: string; message: string }
  | { status: 409; reason: string; message: string }
  | { status: 413; reason: typeof REFUSAL_REASON.payloadTooLarge; field?: string; message: string }
  | { status: 429; reason: typeof REFUSAL_REASON.rateLimited; retryAfterSeconds?: number; message: string }
  | { status: ForwardedRefusalStatus; reason: string; field?: string; message: string; forwarded: true }

export class RefusalError extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.message)
    this.name = 'RefusalError'
  }
}

export function forwardedRefusal(
  status: number,
  reason: string,
  message: string,
  field?: string,
): RefusalError | null {
  if (status < 400 || status >= 500) return null
  return new RefusalError({ status: status as ForwardedRefusalStatus, reason, message, ...(field ? { field } : {}), forwarded: true })
}

export function refusalOf(error: unknown): Refusal | null {
  if (error instanceof RefusalError) return error.refusal
  if (isPlanLimitReachedError(error)) {
    return { status: 402, reason: REFUSAL_REASON.planLimitReached, limit: error.limit, max: error.max, message: error.message }
  }
  return null
}

export function refusalResponse(refusal: Refusal): NextResponse {
  if ('forwarded' in refusal) {
    return NextResponse.json(
      {
        success: false,
        error: refusal.message,
        code: refusal.reason,
        ...(refusal.field !== undefined ? { field: refusal.field } : {}),
      },
      { status: refusal.status },
    )
  }
  const body = refusal.status === 400
    ? buildFieldError(refusal.reason, refusal.field, refusal.message, refusal.allowedValues)
    : {
        success: false,
        error: refusal.message,
        code: refusal.reason,
        ...('field' in refusal && refusal.field !== undefined ? { field: refusal.field } : {}),
        ...(refusal.status === 402 ? { message: refusal.message, limit: refusal.limit, max: refusal.max } : {}),
      }
  return NextResponse.json(body, {
    status: refusal.status,
    ...(refusal.status === 429 && refusal.retryAfterSeconds !== undefined
      ? { headers: { 'Retry-After': String(refusal.retryAfterSeconds) } }
      : {}),
  })
}
