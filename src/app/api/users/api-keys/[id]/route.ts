import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { resolveApiKeyExpiry } from '@/lib/apiKeys'
import { apiKeySelect, getApiKeyOwnerFromCookies } from '@/lib/apiKeyAccess'

export const runtime = 'nodejs'

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params
    const user = await getApiKeyOwnerFromCookies()
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: params.id,
        userId: user.id,
      },
      select: apiKeySelect,
    })

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'API key not found' },
        { status: 404 }
      )
    }

    if (apiKey.revokedAt) {
      return NextResponse.json({
        success: true,
        apiKey,
      })
    }

    await prisma.apiKey.updateMany({
      where: { id: apiKey.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    const revokedApiKey = await prisma.apiKey.findUnique({
      where: { id: apiKey.id },
      select: apiKeySelect,
    })

    return NextResponse.json({
      success: true,
      apiKey: revokedApiKey,
    })
  } catch (error) {
    console.error('Error revoking API key:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params
    const user = await getApiKeyOwnerFromCookies()
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    let parsed: unknown
    try {
      parsed = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON' },
        { status: 400 }
      )
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json(
        { success: false, error: 'Body must be a JSON object' },
        { status: 400 }
      )
    }

    const body = parsed as { expiresInDays?: unknown }

    if (!('expiresInDays' in body)) {
      return NextResponse.json(
        { success: false, error: 'expiresInDays is required' },
        { status: 400 }
      )
    }

    const expiry = resolveApiKeyExpiry(body.expiresInDays ?? null)
    if (!expiry.ok) {
      return NextResponse.json(
        { success: false, error: expiry.error },
        { status: 400 }
      )
    }

    const apiKey = await prisma.apiKey.findFirst({
      where: { id: params.id, userId: user.id },
      select: apiKeySelect,
    })

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'API key not found' },
        { status: 404 }
      )
    }

    if (apiKey.revokedAt) {
      return NextResponse.json(
        { success: false, error: 'Revoked keys cannot be updated' },
        { status: 400 }
      )
    }

    const claimed = await prisma.apiKey.updateMany({
      where: { id: apiKey.id, revokedAt: null },
      data: { expiresAt: expiry.expiresAt },
    })

    if (claimed.count === 0) {
      return NextResponse.json(
        { success: false, error: 'Revoked keys cannot be updated' },
        { status: 400 }
      )
    }

    const updated = await prisma.apiKey.findUnique({
      where: { id: apiKey.id },
      select: apiKeySelect,
    })

    return NextResponse.json({ success: true, apiKey: updated })
  } catch (error) {
    console.error('Error updating API key:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
