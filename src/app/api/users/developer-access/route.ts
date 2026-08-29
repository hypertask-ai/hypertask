import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'

import prisma from '@/lib/prisma'
import { API_KEY_SCOPE_LABEL, isApiKeyUsable } from '@/lib/apiKeys'
import { apiKeySelect, getApiKeyOwnerFromCookies } from '@/lib/apiKeyAccess'
import { parseManagementPermissions } from '@/lib/mcp/managementPermissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/users/developer-access
 *
 * One read for every credential that can act on the account, so Settings can
 * show scope, expiry, and last use in a single list instead of three surfaces
 * that each know about their own key type.
 *
 * The CLI is not a fourth credential: `hypertask login` stores the same MCP
 * bearer token, so it is reported as a client of that token rather than as a
 * separate secret.
 */
export async function GET(_request: NextRequest) {
  try {
    const user = await getApiKeyOwnerFromCookies()
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const now = new Date()

    const [restKeys, managementRows, connections] = await Promise.all([
      prisma.apiKey.findMany({
        where: { userId: user.id },
        select: apiKeySelect,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.betterAuthApiKey.findMany({
        where: { userId: user.id, prefix: 'htmk_' },
        select: {
          id: true,
          name: true,
          start: true,
          permissions: true,
          enabled: true,
          lastRequest: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.oAuthAuthorizationCode.findMany({
        where: { user_id: user.id, used: true },
        select: {
          client_id: true,
          createdAt: true,
          client: { select: { client_name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    // Ordered newest-first, so the first row for a client is its latest use.
    const clientMap = new Map<
      string,
      { id: string; name: string; lastUsedAt: string }
    >()
    for (const row of connections) {
      if (clientMap.has(row.client_id)) continue
      clientMap.set(row.client_id, {
        id: row.client_id,
        name: row.client?.client_name || row.client_id,
        lastUsedAt: row.createdAt.toISOString(),
      })
    }

    const cookieStore = await cookies()
    const mcpTokenCookie = cookieStore.get('mcp_token')?.value
    let mcpExpiresAt: string | null = null
    if (mcpTokenCookie) {
      try {
        const decoded = jwt.decode(mcpTokenCookie) as jwt.JwtPayload | null
        if (decoded?.exp) {
          const expiry = new Date(decoded.exp * 1000)
          if (expiry > now) mcpExpiresAt = expiry.toISOString()
        }
      } catch {
        mcpExpiresAt = null
      }
    }

    return NextResponse.json({
      success: true,
      restApiKeys: restKeys.map((key) => ({
        ...key,
        scope: API_KEY_SCOPE_LABEL,
        active: isApiKeyUsable(key, now),
        expired: Boolean(
          !key.revokedAt && key.expiresAt && key.expiresAt <= now
        ),
      })),
      managementKeys: managementRows.map((row) => ({
        id: String(row.id),
        name: row.name,
        start: row.start,
        permissions: parseManagementPermissions(row.permissions),
        enabled: row.enabled,
        lastRequest: row.lastRequest,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      })),
      // Browser-scoped on purpose: the MCP token lives in a cookie, so this
      // reports the calling browser's token only. A token minted on another
      // device is invisible here, which is why the UI says so rather than
      // claiming the account has none.
      mcpToken: {
        active: Boolean(mcpExpiresAt),
        expiresAt: mcpExpiresAt,
        scope: API_KEY_SCOPE_LABEL,
      },
      connectedClients: Array.from(clientMap.values()),
    })
  } catch (error) {
    console.error('Error loading developer access:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
