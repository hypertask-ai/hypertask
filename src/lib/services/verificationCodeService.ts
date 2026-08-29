import prisma from '@/lib/prisma'
import { randomInt } from 'node:crypto'

export interface VerificationCode {
  id: string
  code: string
  email: string
  expiresAt: Date
  createdAt: Date
  used: boolean
}

// Rate limiting storage (in production, use Redis or database)
const lastRequestTime = new Map<string, number>()

export class VerificationCodeService {
  /**
   * Generate a secure 6-digit verification code
   */
  static generateCode(): string {
    return randomInt(100000, 1000000).toString()
  }

  /**
   * Store a verification code in the database with rate limiting and security measures
   */
  static async storeCode(code: string, email: string, expiresInMinutes: number = 30): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase()
    
    // Rate limiting: 1 minute cooldown between requests per email
    const now = Date.now()
    const lastRequest = lastRequestTime.get(normalizedEmail) || 0
    
    if (now - lastRequest < 60000) { // 1 minute cooldown
      const waitTime = Math.ceil((60000 - (now - lastRequest)) / 1000)
      throw new Error(`Please wait ${waitTime} seconds before requesting another code`)
    }
    
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000)
    
    try {
      // Transaction: Clean up expired codes and store new one atomically
      await prisma.$transaction(async (tx) => {
        // Clean up any expired codes for this email first
        await tx.verificationCode.deleteMany({
          where: {
            email: normalizedEmail,
            expiresAt: { lt: new Date() }
          }
        })
        
        // Upsert: Replace any existing unused code for this email
        await tx.verificationCode.upsert({
          where: { email: normalizedEmail },
          update: {
            code,
            expiresAt,
            used: false,
            createdAt: new Date()
          },
          create: {
            code,
            email: normalizedEmail,
            expiresAt,
            used: false
          }
        })
      })
      
      // Update rate limiting after successful storage
      lastRequestTime.set(normalizedEmail, now)
      
      console.log(`🔐 Stored verification code for ${normalizedEmail}, expires at ${expiresAt.toISOString()}`)
    } catch (error) {
      console.error('❌ Failed to store verification code:', error)
      
      // Specific error handling
      if (error instanceof Error) {
        if (error.message.includes('unique constraint')) {
          throw new Error('A verification code is already active for this email')
        }
        if (error.message.includes('Please wait')) {
          throw error // Re-throw rate limit errors
        }
      }
      
      throw new Error('Failed to store verification code')
    }
  }

  /**
   * Verify and consume a verification code with comprehensive security checks
   */
  static async verifyCode(code: string, email: string): Promise<string | null> {
    if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
      return null
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) return null

    try {
      // One conditional write binds the code to its email and consumes it once.
      // Concurrent requests can read nothing useful ahead of this gate: only
      // one update can change the matching row from unused to used.
      const result = await prisma.verificationCode.updateMany({
        where: {
          code,
          email: normalizedEmail,
          used: false,
          expiresAt: { gt: new Date() },
        },
        data: { used: true },
      })

      return result.count === 1 ? normalizedEmail : null
    } catch (error) {
      console.error('❌ Failed to verify code:', error)
      return null
    }
  }

  /**
   * Clean up expired codes with audit trail preservation
   */
  static async cleanupExpiredCodes(): Promise<void> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      
      // Only delete codes that are both expired AND older than 24 hours (for audit trail)
      const result = await prisma.verificationCode.deleteMany({
        where: {
          AND: [
            { expiresAt: { lt: new Date() } }, // Expired
            { createdAt: { lt: oneDayAgo } }   // Older than 24 hours
          ]
        }
      })
      
      if (result.count > 0) {
        console.log(`🧹 Cleaned up ${result.count} expired verification codes (older than 24h)`)
      }
    } catch (error) {
      console.error('❌ Failed to cleanup expired codes:', error)
    }
  }

  /**
   * Get comprehensive verification code stats for monitoring
   */
  static async getStats() {
    try {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      
      const [total, active, expired, used, recentRequests] = await Promise.all([
        prisma.verificationCode.count(),
        prisma.verificationCode.count({
          where: {
            expiresAt: { gt: now },
            used: false
          }
        }),
        prisma.verificationCode.count({
          where: {
            expiresAt: { lt: now }
          }
        }),
        prisma.verificationCode.count({
          where: { used: true }
        }),
        prisma.verificationCode.count({
          where: {
            createdAt: { gt: oneHourAgo }
          }
        })
      ])

      return { 
        total, 
        active, 
        expired, 
        used, 
        recentRequests,
        rateLimitActive: lastRequestTime.size
      }
    } catch (error) {
      console.error('❌ Failed to get verification code stats:', error)
      return { total: 0, active: 0, expired: 0, used: 0, recentRequests: 0, rateLimitActive: 0 }
    }
  }

  /**
   * Check if an email is currently rate limited
   */
  static isRateLimited(email: string): { limited: boolean; waitTime: number } {
    const normalizedEmail = email.trim().toLowerCase()
    const lastRequest = lastRequestTime.get(normalizedEmail) || 0
    const now = Date.now()
    const timeSinceLastRequest = now - lastRequest
    
    if (timeSinceLastRequest < 60000) {
      return {
        limited: true,
        waitTime: Math.ceil((60000 - timeSinceLastRequest) / 1000)
      }
    }
    
    return { limited: false, waitTime: 0 }
  }

  /**
   * Clean up rate limiting memory periodically
   */
  static cleanupRateLimit(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000
    
    for (const [email, timestamp] of lastRequestTime.entries()) {
      if (timestamp < oneHourAgo) {
        lastRequestTime.delete(email)
      }
    }
    
    console.log(`🧹 Rate limit cleanup: ${lastRequestTime.size} active entries remaining`)
  }
}
