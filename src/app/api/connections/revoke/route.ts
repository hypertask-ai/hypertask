import { readJsonBody } from '@/lib/mcp/readJsonBody'
import { loadCurrentUser } from '@/lib/auth/currentUser'
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from '@/lib/flags'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isValidUser } from '@/utils/edgeHelpers'
import prisma from '@/lib/prisma'
import jwt from 'jsonwebtoken'

/**
 * POST /api/connections/revoke
 * Revokes access for a specific OAuth client for the current user
 * 
 * Body: { client_id: string, agent_id?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const userCookie = cookieStore.get('nookies_user')
    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null)
    let restCompat = false
    if (currentUser) {
      try {
        restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId)
      } catch {
        // Flag lookup failure preserves the legacy entry path.
      }
    }
    const { isValid, user } = restCompat && currentUser
      ? { isValid: true, user: currentUser.user }
      : isValidUser(userCookie?.value)

    if (!isValid || !user || !user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    let body: Awaited<ReturnType<typeof request.json>>
    if (restCompat) {
      // Capture once: preserve accepted non-objects and the original parse error/fallback.
      let jsonError: unknown
      const result = await readJsonBody<typeof body>({
        json: async () => {
          try {
            body = await request.json()
            return body
          } catch (error) {
            jsonError = error
            throw error
          }
        },
      } as Request, {
        invalidJson: () => { throw jsonError },
        invalidObject: () => NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 }),
      })
      if (result.ok) body = result.body
    } else {
      body = await request.json()
    }
    const { client_id, agent_id } = body

    if (!client_id) {
      return NextResponse.json(
        { success: false, error: 'client_id is required' },
        { status: 400 }
      )
    }

    // Verify the client exists
    const client = await prisma.oAuthClient.findUnique({
      where: { client_id }
    })

    if (!client) {
      return NextResponse.json(
        { success: false, error: 'Client not found' },
        { status: 404 }
      )
    }

    // Delete authorization codes for this user/client pair.
    // If agent_id is provided, scope revocation to that specific agent.
    await prisma.oAuthAuthorizationCode.deleteMany({
      where: {
        user_id: user.id,
        client_id: client_id,
        ...(typeof agent_id === 'string' && agent_id.trim().length > 0
          ? { agent_id: agent_id.trim() }
          : {}),
      }
    })

    // HTPR-6200: forget the consent screen approval too, so reconnecting this
    // client asks the user again instead of going through silently.
    await prisma.oAuthClientGrant.deleteMany({
      where: { user_id: user.id, client_id: client_id },
    })

    // Set user-level token revocation timestamp to invalidate ALL tokens
    // This ensures old tokens without jti are also revoked
    await prisma.user.update({
      where: { id: user.id },
      data: { mcpTokensRevokedAt: new Date() },
    })

    // Also revoke the MCP bearer token if it exists
    // MCP bearer tokens are user-specific, so revoking them will disconnect all clients using bearer tokens
    let tokenRevoked = false
    const mcpTokenCookie = cookieStore.get('mcp_token')
    if (mcpTokenCookie?.value) {
      try {
        // Decode the token to get its jti
        const decoded = jwt.decode(mcpTokenCookie.value, { complete: false }) as jwt.JwtPayload | null
        if (decoded?.jti && decoded.exp) {
          // Revoke the token by adding it to the revoked tokens list
          await prisma.revokedToken.upsert({
            where: { jti: decoded.jti },
            create: {
              jti: decoded.jti,
              user_id: user.id,
              revoked_at: new Date(),
              expires_at: new Date(decoded.exp * 1000),
            },
            update: {
              revoked_at: new Date(),
            },
          })
          tokenRevoked = true
        }
      } catch (error) {
        console.error('Error revoking MCP token:', error)
        // Continue even if token revocation fails
      }
    }

    const response = NextResponse.json({
      success: true,
      message: 'Connection revoked successfully',
      tokenRevoked,
    })

    // Delete the bearer token cookie if it was revoked
    if (tokenRevoked) {
      response.cookies.delete('mcp_token')
    }

    return response
  } catch (error) {
    console.error('Error revoking connection:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
