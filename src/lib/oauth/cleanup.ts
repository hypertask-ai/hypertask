import prisma from '@/lib/prisma'

export async function cleanupExpiredOAuthCodes(): Promise<number> {
  try {
    const result = await prisma.oAuthAuthorizationCode.deleteMany({
      where: {
        expires_at: {
          lt: new Date()
        }
      }
    })

    console.log(`[OAuth Cleanup] Deleted ${result.count} expired authorization codes`)
    return result.count
  } catch (error) {
    console.error('[OAuth Cleanup] Error cleaning up expired codes:', error)
    throw error
  }
}

export async function cleanupUsedOAuthCodes(): Promise<number> {
  try {
    const oneHourAgo = new Date()
    oneHourAgo.setHours(oneHourAgo.getHours() - 1)

    const result = await prisma.oAuthAuthorizationCode.deleteMany({
      where: {
        used: true,
        createdAt: {
          lt: oneHourAgo
        }
      }
    })

    console.log(`[OAuth Cleanup] Deleted ${result.count} used authorization codes`)
    return result.count
  } catch (error) {
    console.error('[OAuth Cleanup] Error cleaning up used codes:', error)
    throw error
  }
}

export async function cleanupAllOAuthCodes(): Promise<{
  expired: number
  used: number
}> {
  const expired = await cleanupExpiredOAuthCodes()
  const used = await cleanupUsedOAuthCodes()
  
  return { expired, used }
}
