import prisma from '@/lib/prisma'

/**
 * Cleans up expired OAuth authorization codes from the database
 * Should be run periodically (e.g., via cron job or scheduled task)
 * 
 * @returns Number of codes deleted
 */
export async function cleanupExpiredOAuthCodes(): Promise<number> {
  try {
    const result = await prisma.oAuthAuthorizationCode.deleteMany({
      where: {
        expires_at: {
          lt: new Date() // Delete codes that have expired
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

/**
 * Cleans up used OAuth authorization codes older than 1 hour
 * These are codes that were successfully exchanged but kept for audit purposes
 * 
 * @returns Number of codes deleted
 */
export async function cleanupUsedOAuthCodes(): Promise<number> {
  try {
    const oneHourAgo = new Date()
    oneHourAgo.setHours(oneHourAgo.getHours() - 1)

    const result = await prisma.oAuthAuthorizationCode.deleteMany({
      where: {
        used: true,
        createdAt: {
          lt: oneHourAgo // Delete used codes older than 1 hour
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

/**
 * Runs both cleanup operations
 * 
 * @returns Object with counts of deleted codes
 */
export async function cleanupAllOAuthCodes(): Promise<{
  expired: number
  used: number
}> {
  const expired = await cleanupExpiredOAuthCodes()
  const used = await cleanupUsedOAuthCodes()
  
  return { expired, used }
}
