import { withoutAuth } from "#with-auth";
import { NextRequest, NextResponse } from 'next/server'

/**
 * API endpoint kept for clients that still notify when tutorial is completed or skipped.
 * POST /api/users/onboarded-webhook
 */
async function POSTHandler(_request: NextRequest) {
  const webhookResult = { skipped: true }

  return NextResponse.json({
    success: true,
    webhookResult,
    message: 'Onboarded webhook already sent previously',
  })
}

export const POST = withoutAuth(POSTHandler);
