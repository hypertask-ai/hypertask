import { cookies } from 'next/headers'
import type { IUser } from '@/models/model'
import { getSessionUser } from '@/lib/auth/getSessionUser'
import { isValidUser } from '@/utils/edgeHelpers'

type CurrentUser = { userId: number }
type CurrentUserWithProfile = CurrentUser & { user: IUser }

export function loadCurrentUser(headers: Headers, legacyProfile: true): Promise<CurrentUserWithProfile | null>
export function loadCurrentUser(headers: Headers): Promise<CurrentUser | null>
export async function loadCurrentUser(
  headers: Headers,
  legacyProfile = false,
): Promise<CurrentUserWithProfile | CurrentUser | null> {
  const session = await getSessionUser(headers)
  if (!session) return null

  if (legacyProfile) {
    // Keep the description endpoints' profile precondition and activity actor,
    // but never use the client-writable profile as proof of identity.
    const cookie = (await cookies()).get('nookies_user')
    const { isValid, user } = isValidUser(cookie?.value)
    return isValid && user && user.id === session.userId
      ? { userId: session.userId, user }
      : null
  }

  return { userId: session.userId }
}
