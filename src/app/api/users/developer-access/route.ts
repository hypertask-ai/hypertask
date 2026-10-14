import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'

import prisma from '@/lib/prisma'
import { API_KEY_SCOPE_LABEL, isApiKeyUsable } from '@/lib/apiKeys'
import { apiKeySelect, getApiKeyOwnerFromCookies } from '@/lib/apiKeyAccess'
import {
  HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG,
  isFeatureEnabled,
} from '@/lib/flags'
import { parseManagementPermissions } from '@/lib/mcp/managementPermissions'
import {
  ACCOUNT_MANAGEMENT_KEY_PREFIX,
  TEAM_MANAGEMENT_KEY_PREFIX,
} from '@/lib/mcp/managementKeyTeamScope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    const teamScopedKeysEnabled = await isFeatureEnabled(
      HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG,
      user.id
    )
    const [restKeys, managementRows, connections] = await Promise.all([
      prisma.apiKey.findMany({
        where: { userId: user.id },
        select: apiKeySelect,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.betterAuthApiKey.findMany({
        where: {
          userId: user.id,
          prefix: teamScopedKeysEnabled
            ? {
                in: [ACCOUNT_MANAGEMENT_KEY_PREFIX, TEAM_MANAGEMENT_KEY_PREFIX],
              }
            : ACCOUNT_MANAGEMENT_KEY_PREFIX,
        },
        select: {
          id: true,
          name: true,
          start: true,
          permissions: true,
          enabled: true,
          lastRequest: true,
          expiresAt: true,
          createdAt: true,
          prefix: true,
          team: { select: { id: true, title: true } },
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
        teamScoped: row.prefix === TEAM_MANAGEMENT_KEY_PREFIX,
        team: teamScopedKeysEnabled ? row.team : null,
      })),
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
