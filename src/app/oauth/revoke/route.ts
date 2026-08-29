import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SERIALIZABLE_ATTEMPTS = 3

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function noStoreResponse() {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  })
}

/** Refresh-token revocation for public native clients. Unknown tokens are a no-op. */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const token = formData.get('token')
    const clientId = formData.get('client_id')
    const tokenTypeHint = formData.get('token_type_hint')
    if (typeof token !== 'string' || !token || typeof clientId !== 'string' || !clientId) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'token and client_id are required' },
        { status: 400 },
      )
    }
    if (tokenTypeHint !== null && tokenTypeHint !== 'refresh_token') {
      return NextResponse.json(
        { error: 'unsupported_token_type', error_description: 'Only refresh tokens can be revoked here' },
        { status: 400 },
      )
    }

    const stored = await prisma.oAuthRefreshToken.findUnique({
      where: { tokenHash: tokenHash(token) },
      select: {
        familyId: true,
        clientId: true,
        userId: true,
      },
    })
    if (!stored || stored.clientId !== clientId) {
      return noStoreResponse()
    }

    const now = new Date()
    for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        await prisma.$transaction(async (tx) => {
          const activeSessions = await tx.oAuthRefreshToken.findMany({
            where: { familyId: stored.familyId, clientId, revokedAt: null },
            select: { accessTokenJti: true, accessTokenExpiresAt: true },
          })
          await tx.oAuthRefreshToken.updateMany({
            where: { familyId: stored.familyId, clientId, revokedAt: null },
            data: { revokedAt: now },
          })
          for (const session of activeSessions) {
            if (session.accessTokenExpiresAt <= now) continue
            await tx.revokedToken.upsert({
              where: { jti: session.accessTokenJti },
              create: {
                jti: session.accessTokenJti,
                user_id: stored.userId,
                revoked_at: now,
                expires_at: session.accessTokenExpiresAt,
              },
              update: { revoked_at: now },
            })
          }
        }, { isolationLevel: 'Serializable' })
        break
      } catch (error) {
        if (
          (error as { code?: string })?.code !== 'P2034' ||
          attempt === SERIALIZABLE_ATTEMPTS - 1
        ) {
          throw error
        }
      }
    }
    return noStoreResponse()
  } catch (error) {
    console.error('Error in OAuth revocation endpoint:', error)
    return NextResponse.json(
      { error: 'server_error', error_description: 'Internal server error' },
      { status: 500 },
    )
  }
}
