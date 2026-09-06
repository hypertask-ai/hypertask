import { createHmac, timingSafeEqual } from 'crypto'

/**
 * HTPR-6200: /oauth/authorize used to mint an authorization code straight off the
 * signed-in session cookie, so any site could top-level-navigate a signed-in user
 * into handing over full board access. The code is now minted only by a POST that
 * carries one of these tokens, which the consent screen embeds in its approve form.
 *
 * The token binds the parts of the request that decide who gets access: user,
 * client, redirect URI, PKCE challenge and agent. An approval for one connector
 * can never be replayed against another. response_type and code_challenge_method
 * are not bound because the POST rejects anything but "code" and "S256" outright.
 *
 * ponytail: stateless HMAC, so one approval can mint more than one code inside its
 * short lifetime. Harmless (each code is still one-time-use, PKCE-bound, and for the
 * connector the user just approved) and a cross-site POST cannot reach here because
 * ht_session is SameSite=lax. Swap for a consumed pending-authorization row if a
 * connector ever needs one-code-per-approval.
 */

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

/** True only when the token was issued for exactly this request and has not expired. */
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

  // Compare the encoded strings: base64url decoding silently drops invalid
  // characters, so distinct tokens could decode to the same bytes.
  const presented = Buffer.from(token.slice(separatorIndex + 1), 'utf8')
  const expected = Buffer.from(sign(canonical(request, expiresAt)), 'utf8')

  return presented.length === expected.length && timingSafeEqual(presented, expected)
}
