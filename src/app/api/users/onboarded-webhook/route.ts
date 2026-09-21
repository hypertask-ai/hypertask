import { NextRequest, NextResponse } from 'next/server'

/**
 * API endpoint kept for clients that still notify when tutorial is completed or skipped.
 * POST /api/users/onboarded-webhook
 */
export async function POST(_request: NextRequest) {
  const webhookResult = { skipped: true }

  return NextResponse.json({
    success: true,
    webhookResult,
    message: 'Onboarded webhook already sent previously',
  })
}
