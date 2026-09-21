#!/usr/bin/env tsx

import { VerificationCodeService } from '@/lib/services/verificationCodeService'

/**
 * Cleanup script for expired verification codes
 * Run this periodically (e.g., every hour) to keep the database clean
 */
async function cleanupExpiredCodes() {
  try {
    console.log('🧹 Starting comprehensive cleanup...')
    
    // Clean up expired verification codes
    await VerificationCodeService.cleanupExpiredCodes()
    
    // Clean up rate limiting memory
    VerificationCodeService.cleanupRateLimit()
    
    // Get and display stats
    const stats = await VerificationCodeService.getStats()
    console.log('📊 Verification code stats:', {
      ...stats,
      timestamp: new Date().toISOString()
    })
    
    // Health check alerts
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

// Run cleanup
cleanupExpiredCodes() 