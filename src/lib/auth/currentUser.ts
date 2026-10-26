import { cookies } from 'next/headers'
import type { IUser } from '@/models/model'
import { getSessionUser } from '@/lib/auth/getSessionUser'
import { isValidUser } from '@/utils/edgeHelpers'
import prisma from '@/lib/prisma'

type CurrentUser = { userId: number; agentId?: string }
type CurrentUserWithProfile = CurrentUser & { user: IUser }

export function loadCurrentUser(headers: Headers, legacyProfile: true): Promise<CurrentUserWithProfile | null>
export function loadCurrentUser(headers: Headers): Promise<CurrentUser | null>
export async function loadCurrentUser(
  headers: Headers,
  legacyProfile = false,
): Promise<CurrentUserWithProfile | CurrentUser | null> {
  const session = await getSessionUser(headers)
  if (!session) return null
  const currentUser = { userId: session.userId, ...(session.agentId ? { agentId: session.agentId } : {}) }

  if (legacyProfile) {
    const cookie = (await cookies()).get('nookies_user')
    const { isValid, user } = isValidUser(cookie?.value)
    if (isValid && user && user.id === session.userId) {
      return { ...currentUser, user }
    }
    const profile = await loadProfileFromSession(session.userId)
    return profile ? { ...profile, ...currentUser } : null
  }

  return currentUser
}

async function loadProfileFromSession(userId: number): Promise<CurrentUserWithProfile | null> {
  try {
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
