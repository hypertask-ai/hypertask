import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes, randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import prisma from '@/lib/prisma'
import { validatePKCE } from '@/lib/oauth/pkce'
import {
  createOAuthToken,
  storedAgentTokenGeneration,
} from '@/lib/mcp/auth'

class OAuthTokenSigningError extends Error {
  constructor(readonly originalError: unknown) {
    super('Failed to sign OAuth access token')
  }
}

const MOBILE_REDIRECT_URI = 'hypertask-native://oauth/callback'
const MOBILE_ACCESS_TOKEN_EXPIRY_SECONDS = 60 * 60
const DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS = 90 * 24 * 60 * 60
const REFRESH_TOKEN_EXPIRY_SECONDS = 90 * 24 * 60 * 60
const SERIALIZABLE_ATTEMPTS = 3

function refreshTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function createRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

function clientSupportsRefresh(grantTypes: unknown): boolean {
  return Array.isArray(grantTypes) && grantTypes.includes('refresh_token')
}

function accessTokenIdentity(token: string): { jti: string; expiresAt: Date } {
  const decoded = jwt.decode(token)
  if (!decoded || typeof decoded === 'string' || !decoded.jti || !decoded.exp) {
    throw new Error('OAuth access token is missing rotation claims')
  }
  return {
    jti: decoded.jti,
    expiresAt: new Date(decoded.exp * 1000),
  }
}

function tokenResponse(
  accessToken: string,
  expiresIn?: number,
  refreshToken?: string,
) {
  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      ...(expiresIn ? { expires_in: expiresIn } : {}),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache',
      },
    },
  )
}

async function revokeRefreshFamily(
  familyId: string,
  userId: number,
  now: Date,
) {
  for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const activeSessions = await tx.oAuthRefreshToken.findMany({
          where: { familyId, revokedAt: null },
          select: { accessTokenJti: true, accessTokenExpiresAt: true },
        })
        await tx.oAuthRefreshToken.updateMany({
          where: { familyId, revokedAt: null },
          data: { revokedAt: now },
        })
        for (const session of activeSessions) {
          if (session.accessTokenExpiresAt <= now) continue
          await tx.revokedToken.upsert({
            where: { jti: session.accessTokenJti },
            create: {
              jti: session.accessTokenJti,
              user_id: userId,
              revoked_at: now,
              expires_at: session.accessTokenExpiresAt,
            },
            update: { revoked_at: now },
          })
        }
      }, { isolationLevel: 'Serializable' })
      return
    } catch (error) {
      if (
        (error as { code?: string })?.code !== 'P2034' ||
        attempt === SERIALIZABLE_ATTEMPTS - 1
      ) {
        throw error
      }
    }
  }
}

async function exchangeRefreshToken(formData: FormData) {
  const refreshToken = formData.get('refresh_token')
  const clientId = formData.get('client_id')
  if (typeof refreshToken !== 'string' || !refreshToken || typeof clientId !== 'string' || !clientId) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'refresh_token and client_id are required' },
      { status: 400 },
    )
  }
  const client = await prisma.oAuthClient.findUnique({
    where: { client_id: clientId },
    select: { grant_types: true },
  })
  if (!client || !clientSupportsRefresh(client.grant_types)) {
    return NextResponse.json(
      { error: 'unsupported_grant_type', error_description: 'Client is not registered for refresh_token' },
      { status: 400 },
    )
  }

  const stored = await prisma.oAuthRefreshToken.findUnique({
    where: { tokenHash: refreshTokenHash(refreshToken) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          uid: true,
          mcpTokensRevokedAt: true,
        },
      },
    },
  })
  const now = new Date()
  if (
    !stored ||
    stored.clientId !== clientId ||
    !stored.user.email ||
    !stored.user.uid ||
    stored.firebaseUid !== stored.user.uid ||
    (stored.user.mcpTokensRevokedAt &&
      stored.createdAt <= stored.user.mcpTokensRevokedAt)
  ) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Refresh token is invalid or expired' },
      { status: 400 },
    )
  }
  if (stored.revokedAt) {
    if (stored.replacedByHash) {
      await revokeRefreshFamily(stored.familyId, stored.user.id, now)
    }
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Refresh token is invalid or expired' },
      { status: 400 },
    )
  }
  if (stored.expiresAt <= now) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Refresh token is invalid or expired' },
      { status: 400 },
    )
  }

  const nextAccessToken = createOAuthToken(
    stored.firebaseUid,
    stored.user.id,
    stored.user.email,
    MOBILE_ACCESS_TOKEN_EXPIRY_SECONDS,
  )
  const nextAccessIdentity = accessTokenIdentity(nextAccessToken)
  const nextRefreshToken = createRefreshToken()
  const nextRefreshHash = refreshTokenHash(nextRefreshToken)
  const nextRefreshExpiry = new Date(now.getTime() + REFRESH_TOKEN_EXPIRY_SECONDS * 1000)

  let rotated = false
  for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      rotated = await prisma.$transaction(async (tx) => {
        const currentUser = await tx.user.findUnique({
          where: { id: stored.user.id },
          select: { mcpTokensRevokedAt: true },
        })
        if (
          !currentUser ||
          (currentUser.mcpTokensRevokedAt &&
            stored.createdAt <= currentUser.mcpTokensRevokedAt)
        ) {
          return false
        }

        const consumed = await tx.oAuthRefreshToken.updateMany({
          where: {
            id: stored.id,
            clientId,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now, replacedByHash: nextRefreshHash },
        })
        if (consumed.count !== 1) return false

        await tx.oAuthRefreshToken.create({
          data: {
            tokenHash: nextRefreshHash,
            familyId: stored.familyId,
            clientId,
            userId: stored.user.id,
            firebaseUid: stored.user.uid,
            accessTokenJti: nextAccessIdentity.jti,
            accessTokenExpiresAt: nextAccessIdentity.expiresAt,
            expiresAt: nextRefreshExpiry,
          },
        })
        if (stored.accessTokenExpiresAt > now) {
          await tx.revokedToken.upsert({
            where: { jti: stored.accessTokenJti },
            create: {
              jti: stored.accessTokenJti,
              user_id: stored.user.id,
              revoked_at: now,
              expires_at: stored.accessTokenExpiresAt,
            },
            update: { revoked_at: now },
          })
        }
        return true
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

  if (!rotated) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Refresh token is invalid or expired' },
      { status: 400 },
    )
  }
  return tokenResponse(
    nextAccessToken,
    MOBILE_ACCESS_TOKEN_EXPIRY_SECONDS,
    nextRefreshToken,
  )
}

/**
 * POST /oauth/token
 * 
 * OAuth 2.1 token endpoint with PKCE validation
 * 
 * Accepts form-urlencoded data:
 * - grant_type: Must be "authorization_code"
 * - code: Authorization code from /oauth/authorize
 * - redirect_uri: Must match the redirect_uri used in authorization
 * - client_id: Must match the client_id used in authorization
 * - code_verifier: PKCE code verifier (used to verify code_challenge)
 */
export async function POST(request: NextRequest) {
  try {
    // Parse form-urlencoded body
    const formData = await request.formData()
    const grantType = formData.get('grant_type')
    const code = formData.get('code')
    const redirectUri = formData.get('redirect_uri')
    const clientId = formData.get('client_id')
    const codeVerifier = formData.get('code_verifier')

    if (grantType === 'refresh_token') {
      return await exchangeRefreshToken(formData)
    }

    // Validate grant_type
    if (grantType !== 'authorization_code') {
      return NextResponse.json(
        { error: 'unsupported_grant_type', error_description: 'grant_type must be "authorization_code"' },
        { status: 400 }
      )
    }

    // Validate required parameters
    if (!code || !redirectUri || !clientId || !codeVerifier) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Missing required parameters' },
        { status: 400 }
      )
    }

    // Look up authorization code in database
    const authCode = await prisma.oAuthAuthorizationCode.findUnique({
      where: { code: code as string },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            uid: true
          }
        }
      }
    })

    if (!authCode) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Invalid authorization code' },
        { status: 400 }
      )
    }

    // Verify code not expired
    if (authCode.expires_at < new Date()) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Authorization code has expired' },
        { status: 400 }
      )
    }

    // Verify code not already used
    if (authCode.used) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Authorization code has already been used' },
        { status: 400 }
      )
    }

    // Verify client_id matches and client exists
    if (authCode.client_id !== clientId) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Invalid client_id' },
        { status: 400 }
      )
    }

    // Verify client still exists in database
    const client = await prisma.oAuthClient.findUnique({
      where: { client_id: clientId }
    })

    if (!client) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Client not found' },
        { status: 400 }
      )
    }

    // Verify redirect_uri matches
    if (authCode.redirect_uri !== redirectUri) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'redirect_uri does not match' },
        { status: 400 }
      )
    }

    // Validate PKCE: verify code_verifier against stored code_challenge
    if (!validatePKCE(codeVerifier as string, authCode.code_challenge)) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Invalid code_verifier' },
        { status: 400 }
      )
    }

    const agentId = authCode.agent_id ?? undefined
    let agentTokenJti: string | undefined
    if (agentId) {
      const agent = await prisma.agent.findFirst({
        where: {
          id: agentId,
          userId: authCode.user.id,
          revokedAt: null,
        },
        select: { mcpTokenJti: true },
      })
      // The lookup above is already scoped to this owner and to a live agent,
      // so a generation read here can never belong to another owner's agent.
      agentTokenJti = storedAgentTokenGeneration(agent) ?? undefined

      if (!agentTokenJti) {
        return NextResponse.json(
          {
            error: 'invalid_grant',
            error_description: 'The selected agent does not have an active token.',
          },
          { status: 400 }
        )
      }
    }

    // Do not burn a valid one-time code for a request that cannot mint a token.
    if (!authCode.user.uid || !authCode.user.email) {
      return NextResponse.json(
        { error: 'server_error', error_description: 'User data incomplete' },
        { status: 500 }
      )
    }

    const isRefreshCapableMobile =
      authCode.redirect_uri === MOBILE_REDIRECT_URI &&
      !agentId &&
      clientSupportsRefresh(client.grant_types)
    const accessTokenExpirySeconds = isRefreshCapableMobile
      ? MOBILE_ACCESS_TOKEN_EXPIRY_SECONDS
      : DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS
    let session: { accessToken: string; refreshToken?: string } | null

    // The conditional write is the one-time consume gate. Token signing stays
    // in the same transaction so a signing failure rolls the consume back.
    // Concurrent requests may validate the same unused snapshot, but only one
    // transaction can consume the code and return a token.
    try {
      session = await prisma.$transaction(async (tx) => {
        const consumed = await tx.oAuthAuthorizationCode.updateMany({
          where: { code: code as string, used: false },
          data: { used: true }
        })
        if (consumed.count !== 1) return null

        try {
          const accessToken = createOAuthToken(
            authCode.firebase_uid,
            authCode.user.id,
            authCode.user.email,
            accessTokenExpirySeconds,
            agentId,
            agentTokenJti
          )
          if (!isRefreshCapableMobile) return { accessToken }

          const accessIdentity = accessTokenIdentity(accessToken)
          const refreshToken = createRefreshToken()
          await tx.oAuthRefreshToken.create({
            data: {
              tokenHash: refreshTokenHash(refreshToken),
              familyId: randomUUID(),
              clientId: authCode.client_id,
              userId: authCode.user.id,
              firebaseUid: authCode.firebase_uid,
              accessTokenJti: accessIdentity.jti,
              accessTokenExpiresAt: accessIdentity.expiresAt,
              expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_SECONDS * 1000),
            },
          })
          return { accessToken, refreshToken }
        } catch (error) {
          throw new OAuthTokenSigningError(error)
        }
      })

      if (!session) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Authorization code has already been used' },
          { status: 400 }
        )
      }
    } catch (error) {
      if (error instanceof OAuthTokenSigningError) throw error.originalError

      console.error('Error marking authorization code as used:', error)
      return NextResponse.json(
        { error: 'server_error', error_description: 'Failed to process authorization code' },
        { status: 500 }
      )
    }

    return tokenResponse(
      session.accessToken,
      agentId ? undefined : accessTokenExpirySeconds,
      session.refreshToken,
    )
  } catch (error) {
    console.error('Error in OAuth token endpoint:', error)
    return NextResponse.json(
      { error: 'server_error', error_description: 'Internal server error' },
      { status: 500 }
    )
  }
}
