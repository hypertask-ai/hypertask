import { cookies } from 'next/headers'
import type { IUser } from '@/models/model'
import { getSessionUser } from '@/lib/auth/getSessionUser'
import { isValidUser } from '@/utils/edgeHelpers'
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from '@/lib/flags'
import prisma from '@/lib/prisma'

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
    if (isValid && user && user.id === session.userId) {
      return { userId: session.userId, user }
    }
    return loadProfileFromSession(session.userId)
  }

  return { userId: session.userId }
}

// HTPR-7073: the profile cookie lives shorter than the signed session, so a signed-in
// person can lack it. With the REST compat flag on, load the profile of the signed session
// user from the database; flag off, unknown user or lookup failure keeps the legacy null (401).
async function loadProfileFromSession(userId: number): Promise<CurrentUserWithProfile | null> {
  try {
    if (!(await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, userId))) return null
    const row = await prisma.user.findUnique({
      where: { id: userId },
      include: { UserSetting: true, userPicture: true },
    })
    if (!row) return null
    const user = {
      ...row,
      notificationPreference: row.UserSetting?.notificationPreference || 'direct',
    } as unknown as IUser
    return { userId, user }
  } catch {
    return null
  }
}
