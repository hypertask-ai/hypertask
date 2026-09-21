import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import {
  activeApiKeyWhere,
  generateApiKey,
  resolveApiKeyExpiry,
} from '@/lib/apiKeys'
import { apiKeySelect, getApiKeyOwnerFromCookies } from '@/lib/apiKeyAccess'

export const runtime = 'nodejs'

const MAX_ACTIVE_API_KEYS = 10

export async function GET(_request: NextRequest) {
  try {
    const user = await getApiKeyOwnerFromCookies()
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      select: apiKeySelect,
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      success: true,
      apiKeys,
    })
  } catch (error) {
    console.error('Error listing API keys:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getApiKeyOwnerFromCookies()
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    let body: { name?: unknown; expiresInDays?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON' },
        { status: 400 }
      )
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'name is required' },
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

    // Expired keys cannot authenticate, so they must not consume a slot —
    // otherwise ten lapsed keys would permanently block creating a new one.
    const activeCount = await prisma.apiKey.count({
      where: {
        userId: user.id,
        ...activeApiKeyWhere(),
      },
    })

    if (activeCount >= MAX_ACTIVE_API_KEYS) {
      return NextResponse.json(
        { success: false, error: 'Maximum active API keys reached' },
        { status: 400 }
      )
    }

    const generated = generateApiKey()
    const apiKey = await prisma.apiKey.create({
      data: {
        userId: user.id,
        name,
        keyHash: generated.keyHash,
        keyPrefix: generated.keyPrefix,
        expiresAt: expiry.expiresAt,
      },
      select: apiKeySelect,
    })

    return NextResponse.json({
      success: true,
      apiKey: {
        ...apiKey,
        key: generated.key,
      },
    })
  } catch (error) {
    console.error('Error creating API key:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
