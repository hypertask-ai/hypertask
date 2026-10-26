import { readJsonBody } from '@/lib/mcp/readJsonBody'
import { loadCurrentUser } from '@/lib/auth/currentUser'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isValidUser } from '@/utils/edgeHelpers'
import prisma from '@/lib/prisma'
import jwt from 'jsonwebtoken'

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const userCookie = cookieStore.get('nookies_user')
    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null)
    const { isValid, user } = currentUser
      ? { isValid: true, user: currentUser.user }
      : isValidUser(userCookie?.value)

    if (!isValid || !user || !user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    let body: Awaited<ReturnType<typeof request.json>>
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
    const { client_id, agent_id } = body

    if (!client_id) {
      return NextResponse.json(
        { success: false, error: 'client_id is required' },
        { status: 400 }
      )
    }

    const client = await prisma.oAuthClient.findUnique({
      where: { client_id }
    })

    if (!client) {
      return NextResponse.json(
        { success: false, error: 'Client not found' },
        { status: 404 }
      )
    }

    await prisma.oAuthAuthorizationCode.deleteMany({
      where: {
        user_id: user.id,
        client_id: client_id,
        ...(typeof agent_id === 'string' && agent_id.trim().length > 0
          ? { agent_id: agent_id.trim() }
          : {}),
      }
    })

    await prisma.oAuthClientGrant.deleteMany({
      where: { user_id: user.id, client_id: client_id },
    })

    await prisma.user.update({
      where: { id: user.id },
      data: { mcpTokensRevokedAt: new Date() },
    })

    let tokenRevoked = false
    const mcpTokenCookie = cookieStore.get('mcp_token')
    if (mcpTokenCookie?.value) {
      try {
        const decoded = jwt.decode(mcpTokenCookie.value, { complete: false }) as jwt.JwtPayload | null
        if (decoded?.jti && decoded.exp) {
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
      }
    }

    const response = NextResponse.json({
      success: true,
      message: 'Connection revoked successfully',
      tokenRevoked,
    })

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
