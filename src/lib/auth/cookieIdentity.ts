import { verifySessionEdge } from '@/lib/auth/sessionEdge'

export type CookieIdentity =
  | { status: 'unauthenticated' }
  | { status: 'verified'; id: number }
  | { status: 'forged' }

export async function verifyCookieIdentity(
  nookiesUser: string | undefined,
  htSession: string | undefined,
  verifiedSession?: Awaited<ReturnType<typeof verifySessionEdge>>,
): Promise<CookieIdentity> {
  if (!nookiesUser) return { status: 'unauthenticated' }

  let claimedId: unknown
  try {
    claimedId = JSON.parse(nookiesUser)?.id
  } catch {
    return { status: 'forged' }
  }

  if (claimedId === undefined || claimedId === null) return { status: 'unauthenticated' }

  const claimed = Number(claimedId)
  if (!Number.isFinite(claimed)) return { status: 'forged' }

  const session = verifiedSession === undefined ? await verifySessionEdge(htSession) : verifiedSession
  if (!session || Number(session.id) !== claimed) return { status: 'forged' }

  return { status: 'verified', id: claimed }
}
