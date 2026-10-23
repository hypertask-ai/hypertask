import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers';
import { agentTokenCredentialFields, createMcpToken, revokeTokenByJti, validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import jwt from 'jsonwebtoken'
import { verifySession, SESSION_COOKIE } from '@/lib/auth/session'
import { isSessionTokenRevoked } from '@/lib/auth/sessionRevocation'

const NON_EXPIRING_TOKEN_REVOKED_UNTIL = new Date('9999-12-31T23:59:59.999Z')

function getTokenRevocationExpiry(decoded: jwt.JwtPayload) {
  return decoded.exp
    ? new Date(decoded.exp * 1000)
    : NON_EXPIRING_TOKEN_REVOKED_UNTIL
}

async function getCurrentUserFromCookies() {
  try {
    const cookieStore = await cookies()
    const userCookie = cookieStore.get('nookies_user')
    
    if (!userCookie?.value) {
      return null
    }

    const user = JSON.parse(userCookie.value)
    const token = cookieStore.get(SESSION_COOKIE)?.value
    const session = verifySession(token)
    if (!session || String(session.id) !== String(user?.id)) {
      return null
    }

    if (await isSessionTokenRevoked(token, { failClosed: true })) return null

    return user
  } catch (error) {
    console.error('Error parsing user cookie:', error)
    return null
  }
}

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const user = await getCurrentUserFromCookies()
    
    if (!user || !user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const cookieStore = await cookies()
    const tokenCookie = cookieStore.get('mcp_token')
    
    if (tokenCookie?.value) {
      try {
        const decoded = jwt.decode(tokenCookie.value) as jwt.JwtPayload
        const expiresAt = decoded.exp ? new Date(decoded.exp * 1000) : null
        
        if (expiresAt && expiresAt < new Date()) {
          const response = NextResponse.json({
            success: true,
            hasToken: false,
            message: 'Token expired. Generate a new one.'
          })
          response.cookies.delete('mcp_token')
          return response
        }
        
        return NextResponse.json({
          success: true,
          hasToken: true,
          expiresAt: expiresAt?.toISOString(),
          message: 'Token exists'
        })
      } catch (error) {
        const response = NextResponse.json({
          success: true,
          hasToken: false,
          message: 'Invalid token. Generate a new one.'
        })
        response.cookies.delete('mcp_token')
        return response
      }
    }
    
    return NextResponse.json({
      success: true,
      hasToken: false,
      message: 'Token can be generated'
    })
  } catch (error) {
    console.error('Error checking MCP token:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }

  })(request)
}

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const user = await getCurrentUserFromCookies()
    
    if (!user || !user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, displayName: true }
    })

    if (!dbUser) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      )
    }

    const cookieStore = await cookies()
    const mcpTokenCookie = cookieStore.get('mcp_token')
    if (mcpTokenCookie?.value) {
      try {
        const decoded = jwt.decode(mcpTokenCookie.value) as jwt.JwtPayload | null
        if (decoded?.jti && decoded.exp) {
          await revokeTokenByJti(decoded.jti, user.id, new Date(decoded.exp * 1000))
        }
      } catch (error) {
        console.error('Error revoking previous token:', error)
      }
    }

    const token = createMcpToken(user.id, dbUser.email, '30d')

    const decoded = jwt.decode(token) as jwt.JwtPayload
    const expiresAt = decoded.exp ? new Date(decoded.exp * 1000) : null

    const response = NextResponse.json({
      success: true,
      token,
      expiresAt: expiresAt?.toISOString(),
      message: 'MCP token generated successfully'
    })

    const maxAge = 30 * 24 * 60 * 60
    response.cookies.set('mcp_token', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: maxAge,
      path: '/'
    })

    return response
  } catch (error) {
    console.error('Error generating MCP token:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to generate token' },
      { status: 500 }
    )
  }

  })(request)
}

export async function DELETE(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)

    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    if (ctx.management) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Management keys are revoked via DELETE /api/mcp/admin/keys, not this endpoint.',
        },
        { status: 400 }
      )
    }

    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null
    const decoded = token ? jwt.decode(token) as jwt.JwtPayload | null : null

    if (ctx.agentId) {
      await prisma.agent.updateMany({
        where: {
          id: ctx.agentId,
          userId: ctx.user.id,
        },
        data: {
          ...agentTokenCredentialFields(null),
          mcpTokenExpiresAt: null,
          runtimeGeneration: { increment: 1 },
        },
      })
    } else if (decoded?.jti) {
      await revokeTokenByJti(
        decoded.jti,
        ctx.user.id,
        getTokenRevocationExpiry(decoded)
      )
    } else {
      await prisma.user.update({
        where: { id: ctx.user.id },
        data: { mcpTokensRevokedAt: new Date() },
      })
    }

    const response = NextResponse.json({
      success: true,
      message: 'Token revoked'
    })

    response.cookies.set('mcp_token', '', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/'
    })

    return response
  } catch (error) {
    console.error('Error revoking MCP token:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to revoke token' },
      { status: 500 }
    )
  }

  })(request)
}
