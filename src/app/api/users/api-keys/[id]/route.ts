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

/**
 * PATCH /api/users/api-keys/:id
 *
 * Changes the expiry of an existing key without reissuing its secret. Passing
 * `expiresInDays: null` clears the expiry; passing a day count moves the expiry
 * to that many days from now. Use this to expire a key on a schedule; use
 * DELETE to kill it immediately.
 */
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

    // A bare `null` or a primitive is valid JSON but not a valid patch body, so
    // reject it rather than reading a property off it and returning a 500.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json(
        { success: false, error: 'Body must be a JSON object' },
        { status: 400 }
      )
    }

    const body = parsed as { expiresInDays?: unknown }

    // Omitting the field means "no change"; only an explicit null clears the
    // expiry, so an empty patch cannot silently make a key live forever.
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

    // Constrain the write to still-active keys so a revoke landing between the
    // read above and this update is not quietly overwritten.
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
