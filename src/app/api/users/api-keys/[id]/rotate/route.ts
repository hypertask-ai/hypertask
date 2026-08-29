import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { generateApiKey, resolveApiKeyExpiry } from '@/lib/apiKeys'
import { apiKeySelect, getApiKeyOwnerFromCookies } from '@/lib/apiKeyAccess'
import {
  rotateApiKeyInTransaction,
  type RotationTransactionClient,
} from '@/lib/apiKeyRotation'

export const runtime = 'nodejs'

/**
 * POST /api/users/api-keys/:id/rotate
 *
 * Issues a fresh secret under the same name and invalidates the old one in the
 * same transaction, so a leaked key stops working the moment its replacement
 * exists. Pass `expiresInDays` to set the replacement's lifetime; omit it to
 * carry over the remaining lifetime of the key being rotated.
 */
export async function POST(
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

    let body: { expiresInDays?: unknown } = {}
    try {
      body = (await request.json()) ?? {}
    } catch {
      // An empty body is valid: it means "keep the current expiry".
      body = {}
    }

    const hasExpiryChoice =
      body.expiresInDays !== undefined && body.expiresInDays !== null
    const expiry = resolveApiKeyExpiry(
      hasExpiryChoice ? body.expiresInDays : null
    )
    if (!expiry.ok) {
      return NextResponse.json(
        { success: false, error: expiry.error },
        { status: 400 }
      )
    }

    const existing = await prisma.apiKey.findFirst({
      where: { id: params.id, userId: user.id },
      select: { ...apiKeySelect, userId: true },
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'API key not found' },
        { status: 404 }
      )
    }

    if (existing.revokedAt) {
      return NextResponse.json(
        { success: false, error: 'Revoked keys cannot be rotated' },
        { status: 400 }
      )
    }

    const generated = generateApiKey()
    const now = new Date()
    const sourceExpired =
      existing.expiresAt !== null && existing.expiresAt.getTime() <= now.getTime()

    // Carrying over an already-past expiry would mint a replacement that cannot
    // authenticate, so an expired key can only be rotated with a fresh lifetime.
    if (sourceExpired && !hasExpiryChoice) {
      return NextResponse.json(
        {
          success: false,
          error: 'Expired keys need an explicit expiresInDays when rotating',
        },
        { status: 400 }
      )
    }

    const created = await prisma.$transaction((tx: RotationTransactionClient) =>
      rotateApiKeyInTransaction(tx, {
        id: existing.id,
        userId: existing.userId,
        name: existing.name,
        keyHash: generated.keyHash,
        keyPrefix: generated.keyPrefix,
        expiresAt: hasExpiryChoice ? expiry.expiresAt : existing.expiresAt,
        now,
        select: apiKeySelect,
      })
    )

    if (!created) {
      return NextResponse.json(
        { success: false, error: 'API key was already rotated or revoked' },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      apiKey: {
        ...created,
        key: generated.key,
      },
    })
  } catch (error) {
    console.error('Error rotating API key:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
