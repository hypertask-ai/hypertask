#!/usr/bin/env tsx

import { VerificationCodeService } from '@/lib/services/verificationCodeService'

async function cleanupExpiredCodes() {
  try {
    console.log('🧹 Starting comprehensive cleanup...')
    
    await VerificationCodeService.cleanupExpiredCodes()
    
    VerificationCodeService.cleanupRateLimit()
    
    const stats = await VerificationCodeService.getStats()
    console.log('📊 Verification code stats:', {
      ...stats,
      timestamp: new Date().toISOString()
    })
    
    if (stats.active > 100) {
      console.warn('⚠️  High number of active codes detected:', stats.active)
    }
    
    if (stats.recentRequests > 1000) {
      console.warn('⚠️  High request volume in last hour:', stats.recentRequests)
    }
    
    console.log('✅ Cleanup completed successfully')
  } catch (error) {
    console.error('❌ Cleanup failed:', error)
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

cleanupExpiredCodes() 