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
export const JWT_OAUTH_AUDIENCE =
  process.env.JWT_OAUTH_AUDIENCE || 'http://localhost:3001'

export function hasOAuthAccessTokenClaims(token: string): boolean {
  const decoded = jwt.decode(token)
  if (!decoded || typeof decoded === 'string') return false
  const audiences = Array.isArray(decoded.aud)
    ? decoded.aud
    : decoded.aud
      ? [decoded.aud]
      : []
  return (
    decoded.iss === JWT_OAUTH_ISSUER &&
    audiences.includes(JWT_OAUTH_AUDIENCE)
  )
}
