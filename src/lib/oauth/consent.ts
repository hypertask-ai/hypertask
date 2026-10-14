import { createHmac, timingSafeEqual } from 'crypto'


export const CONSENT_TOKEN_TTL_SECONDS = 300

export type ConsentRequest = {
  userId: number
  clientId: string
  redirectUri: string
  codeChallenge: string
  agentId?: string | null
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET
  if (!secret) {
    throw new Error('Missing SESSION_SECRET or JWT_SECRET env var')
  }
  return secret
}

function canonical(request: ConsentRequest, expiresAt: number): string {
  return JSON.stringify([
    'v1',
    request.userId,
    request.clientId,
    request.redirectUri,
    request.codeChallenge,
    request.agentId ?? null,
    expiresAt,
  ])
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

export function signConsentToken(
  request: ConsentRequest,
  ttlSeconds: number = CONSENT_TOKEN_TTL_SECONDS
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
  return `${expiresAt}.${sign(canonical(request, expiresAt))}`
}

export function verifyConsentToken(
  token: string | null | undefined,
  request: ConsentRequest
): boolean {
  if (!token) return false

  const separatorIndex = token.indexOf('.')
  if (separatorIndex < 1) return false

  const expiresAt = Number(token.slice(0, separatorIndex))
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false
  }

  const presented = Buffer.from(token.slice(separatorIndex + 1), 'utf8')
  const expected = Buffer.from(sign(canonical(request, expiresAt)), 'utf8')

  return presented.length === expected.length && timingSafeEqual(presented, expected)
}
