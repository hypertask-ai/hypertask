import { NextRequest, NextResponse } from 'next/server'
import { cleanupAllOAuthCodes } from '@/lib/oauth/cleanup'

/**
 * POST /api/admin/cleanup-oauth-codes
 * 
 * Administrative endpoint to clean up expired and used OAuth authorization codes
 * Should be called periodically (e.g., via cron job or scheduled task)
 * 
 * Security: protected by the server-only ADMIN_SECRET bearer token
 */
export async function POST(request: NextRequest) {
  try {
    const adminSecret = process.env.ADMIN_SECRET
    const authHeader = request.headers.get('Authorization')
    if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🧹 Starting OAuth authorization code cleanup via API...')
    
    const result = await cleanupAllOAuthCodes()
    
    return NextResponse.json({
      success: true,
      expiredCodesDeleted: result.expired,
      usedCodesDeleted: result.used,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('❌ OAuth cleanup failed:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: 'Cleanup failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
