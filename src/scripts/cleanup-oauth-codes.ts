#!/usr/bin/env tsx
import { logger as htLogger } from "#logger";

import { cleanupAllOAuthCodes } from '@/lib/oauth/cleanup'

/**
 * Cleanup script for expired and used OAuth authorization codes
 * Run this periodically (e.g., every hour) to keep the database clean
 * 
 * Usage:
 *   npm run cleanup:oauth-codes
 *   or
 *   tsx src/scripts/cleanup-oauth-codes.ts
 */
async function cleanupOAuthCodes() {
  try {
    htLogger.info('🧹 Starting OAuth authorization code cleanup...')
    
    const result = await cleanupAllOAuthCodes()
    
    htLogger.info('📊 Cleanup results:', {
      expiredCodesDeleted: result.expired,
      usedCodesDeleted: result.used,
      timestamp: new Date().toISOString()
    })
    
    htLogger.info('✅ OAuth cleanup completed successfully')
  } catch (error) {
    htLogger.error('❌ OAuth cleanup failed:', error)
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

// Run cleanup
cleanupOAuthCodes()
