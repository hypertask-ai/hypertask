import { verifySessionEdge } from '@/lib/auth/sessionEdge'

/**
 * The nookies_user cookie is client-writable JSON (httpOnly: false), so its
 * `id` is a *claim*, not proof. ht_session is HMAC-signed server-side. Identity
 * is only trustworthy when the two agree.
 *
 * - "unauthenticated": no usable id claimed — public / logged out / machine
 *   caller. Callers pass these through; the route decides what to do.
 * - "verified": the claim is backed by a signed session for the same user.
 * - "forged": a claim with no matching signature. Reject, and clear the cookies.
 */
export type CookieIdentity =
  | { status: 'unauthenticated' }
  | { status: 'verified'; id: number }
  | { status: 'forged' }

export async function verifyCookieIdentity(
  nookiesUser: string | undefined,
  htSession: string | undefined
): Promise<CookieIdentity> {
  if (!nookiesUser) return { status: 'unauthenticated' }

  // Unparseable means someone hand-edited the cookie (or it is corrupt). Fail
  // closed so the bad value gets cleared rather than silently ignored.
  let claimedId: unknown
  try {
    claimedId = JSON.parse(nookiesUser)?.id
  } catch {
    return { status: 'forged' }
  }

  // Present but claiming no id — nothing to impersonate with.
  if (claimedId === undefined || claimedId === null) return { status: 'unauthenticated' }

  // Coerce rather than type-check: a claim of "6" is still only honoured if a
  // signed session says 6, so coercion cannot weaken the check. Anything that
  // is not a number at all is a hand-edited cookie — fail closed.
  const claimed = Number(claimedId)
  if (!Number.isFinite(claimed)) return { status: 'forged' }

  const session = await verifySessionEdge(htSession)
  if (!session || Number(session.id) !== claimed) return { status: 'forged' }

  return { status: 'verified', id: claimed }
}
