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

const lastRequestTime = new Map<string, number>()

export class VerificationCodeService {
  static generateCode(): string {
    return randomInt(100000, 1000000).toString()
  }

  static async storeCode(code: string, email: string, expiresInMinutes: number = 30): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase()
    
    const now = Date.now()
    const lastRequest = lastRequestTime.get(normalizedEmail) || 0
    
    if (now - lastRequest < 60000) {
      const waitTime = Math.ceil((60000 - (now - lastRequest)) / 1000)
      throw new Error(`Please wait ${waitTime} seconds before requesting another code`)
    }
    
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000)
    
    try {
      await prisma.verificationCode.upsert({
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
      
      lastRequestTime.set(normalizedEmail, now)
      
      console.log(`🔐 Stored verification code for ${normalizedEmail}, expires at ${expiresAt.toISOString()}`)
    } catch (error) {
      console.error('❌ Failed to store verification code:', error)
      
      if (error instanceof Error) {
        if (error.message.includes('unique constraint')) {
          throw new Error('A verification code is already active for this email')
        }
        if (error.message.includes('Please wait')) {
          throw error
        }
      }
      
      throw new Error('Failed to store verification code')
    }
  }

  static async verifyCode(code: string, email: string): Promise<string | null> {
    if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
      return null
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) return null

    try {
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

  static async cleanupExpiredCodes(): Promise<void> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      
      const result = await prisma.verificationCode.deleteMany({
        where: {
          AND: [
            { expiresAt: { lt: new Date() } },
            { createdAt: { lt: oneDayAgo } }
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
