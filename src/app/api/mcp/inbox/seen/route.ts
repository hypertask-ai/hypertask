import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, createUnauthorizedResponse, validateMcpAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { broadcastInboxChange } from '@/lib/realtime/server'

const MAX_NOTIFICATION_IDS = 100

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return createUnauthorizedResponse(
        'Invalid or missing authentication token.',
        'invalid_token'
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body.' },
        { status: 400 }
      )
    }

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: 'JSON body must be an object.' },
        { status: 400 }
      )
    }

    const rawIds = (body as Record<string, unknown>).notification_ids
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'notification_ids must be a non-empty array.' },
        { status: 400 }
      )
    }
    if (rawIds.length > MAX_NOTIFICATION_IDS) {
      return NextResponse.json(
        { success: false, error: `notification_ids cannot exceed ${MAX_NOTIFICATION_IDS} entries.` },
        { status: 400 }
      )
    }

    const notificationIds = [
      ...new Set(
        rawIds
          .map((value) =>
            typeof value === 'number' || typeof value === 'string'
              ? Number(value)
              : Number.NaN
          )
          .filter((id): id is number => Number.isSafeInteger(id) && id > 0)
      ),
    ]

    if (notificationIds.length === 0) {
      return NextResponse.json(
        { success: false, error: `Provide between 1 and ${MAX_NOTIFICATION_IDS} valid notification ids.` },
        { status: 400 }
      )
    }

    const result = await prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        userId: ctx.user.id,
        seen: false,
      },
      data: { seen: true },
    })

    if (result.count > 0) {
      void broadcastInboxChange(ctx.user.id, { originUserId: ctx.user.id })
    }

    return NextResponse.json({
      success: true,
      seen_count: result.count,
    })
  } catch (error) {
    console.error('Error marking inbox notifications seen:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
