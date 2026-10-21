import { NextRequest, NextResponse } from 'next/server'

export async function POST(_request: NextRequest) {
  const webhookResult = { skipped: true }

  return NextResponse.json({
    success: true,
    webhookResult,
    message: 'Onboarded webhook already sent previously',
  })
}
