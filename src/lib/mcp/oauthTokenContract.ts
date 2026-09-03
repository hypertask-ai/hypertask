import jwt from 'jsonwebtoken'

/**
 * The claims used by both OAuth token issuance and consumers.
 *
 * The legacy audience remains the fallback because existing user OAuth tokens
 * were minted with it when JWT_OAUTH_AUDIENCE was not configured. Keeping the
 * value in one module prevents a consumer from silently rejecting tokens that
 * this deployment issued itself.
 */
export const JWT_OAUTH_ISSUER =
  process.env.JWT_ISSUER || 'https://app.hypertask.ai'
export const JWT_LEGACY_OAUTH_AUDIENCE = 'http://localhost:3001'
export const JWT_OAUTH_AUDIENCE =
  process.env.JWT_OAUTH_AUDIENCE || JWT_LEGACY_OAUTH_AUDIENCE
export const OAUTH_CLIENT_ID_CLAIM = 'client_id'

export const oauthLegacyRevocationJti = (userId: number) =>
  `user:${userId}:oauth:legacy`

export function isOAuthAccessTokenPayload(
  decoded: jwt.JwtPayload,
): boolean {
  const audiences = Array.isArray(decoded.aud)
    ? decoded.aud
    : decoded.aud
      ? [decoded.aud]
      : []
  return (
    decoded.iss === JWT_OAUTH_ISSUER &&
    (audiences.includes(JWT_OAUTH_AUDIENCE) ||
      audiences.includes(JWT_LEGACY_OAUTH_AUDIENCE))
  )
}

export function oauthClientIdFromPayload(
  decoded: jwt.JwtPayload,
): string | null | undefined {
  const clientId = decoded[OAUTH_CLIENT_ID_CLAIM]
  if (clientId === undefined) return undefined
  if (typeof clientId !== 'string' || !clientId || clientId.length > 64) {
    return null
  }
  return clientId
}

export function hasOAuthAccessTokenClaims(token: string): boolean {
  const decoded = jwt.decode(token)
  return Boolean(
    decoded &&
    typeof decoded !== 'string' &&
    isOAuthAccessTokenPayload(decoded),
  )
}
