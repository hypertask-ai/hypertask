import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, createUnauthorizedResponse, checkMcpRateLimit } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { broadcastInboxChange } from '@/lib/realtime/server'

interface InboxUnarchiveResponse {
  success: boolean
  unarchived_count: number
}

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
    const user = ctx.user;
    let body: { notification_ids?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body.' },
        { status: 400 }
      )
    }

    const rawIds = body.notification_ids
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'notification_ids must be a non-empty array.' },
        { status: 400 }
      )
    }

    const notificationIds = rawIds
      .map((id) => (typeof id === 'number' ? id : parseInt(String(id), 10)))
      .filter((id) => !isNaN(id) && id > 0)

    if (notificationIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid notification ids provided.' },
        { status: 400 }
      )
    }

    const result = await prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        userId: user.id,
        status: 'Archive',
      },
      data: {
        status: 'Normal',
        archivedAt: null,
      },
    })

    const response: InboxUnarchiveResponse = {
      success: true,
      unarchived_count: result.count,
    }

    void broadcastInboxChange(user.id, { originUserId: user.id })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error unarchiving inbox notifications:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
