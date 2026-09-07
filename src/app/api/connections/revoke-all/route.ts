import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isValidUser } from '@/utils/edgeHelpers'
import prisma from '@/lib/prisma'
import jwt from 'jsonwebtoken'

/**
 * POST /api/connections/revoke-all
 * Revokes all OAuth connections for the current user
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const userCookie = cookieStore.get('nookies_user')
    const { isValid, user } = isValidUser(userCookie?.value)

    if (!isValid || !user || !user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Delete all OAuth authorization codes for this user
    const oauthResult = await prisma.oAuthAuthorizationCode.deleteMany({
      where: {
        user_id: user.id,
      }
    })

    // HTPR-6200: forget every consent screen approval too, so reconnecting any
    // client asks the user again instead of going through silently.
    await prisma.oAuthClientGrant.deleteMany({ where: { user_id: user.id } })

    // Set user-level token revocation timestamp to invalidate ALL tokens (including old ones without jti)
    await prisma.user.update({
      where: { id: user.id },
      data: { mcpTokensRevokedAt: new Date() },
    })

    // Revoke the MCP bearer token if it exists in cookies
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

    // Also delete the bearer token cookie to disconnect clients using bearer tokens
    // (like Claude Desktop and Cursor MCP)
    const response = NextResponse.json({
      success: true,
      message: `Revoked ${oauthResult.count} OAuth connection(s)${tokenRevoked ? ' and MCP bearer token' : ''} successfully`,
      oauthCount: oauthResult.count,
      tokenRevoked,
    })

    // Delete the bearer token cookie
    response.cookies.delete('mcp_token')

    return response
  } catch (error) {
    console.error('Error revoking all connections:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
