import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth/betterAuth'
import {
  checkMcpRateLimit,
  createUnauthorizedResponse,
  MANAGEMENT_KEY_PREFIX,
  validateManagementOrSessionAuth,
} from '@/lib/mcp/auth'
import { isFeatureEnabled } from '@/lib/flags'
import { TEAM_SCOPED_MANAGEMENT_KEYS_FLAG } from '@/lib/flags/keys'
import {
  FULL_MANAGEMENT_KEY_PERMISSIONS,
  hasLegacyFullPermissionShape,
  hasUsageReadPermission,
  isPermissionSubset,
  MANAGEMENT_KEY_PERMISSIONS,
  parseManagementPermissions,
  USAGE_READ_KEY_PERMISSIONS,
} from '@/lib/mcp/managementPermissions'
import {
  getManagementKeyTeam,
  listManagementKeyTeams,
  TEAM_MANAGEMENT_KEY_PREFIX,
} from '@/lib/mcp/managementKeyTeamScope'
import prisma from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(32),
  scope: z.enum(['management', 'usage', 'full']).default('management'),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  teamId: z.string().uuid().optional(),
})

const deleteKeySchema = z.object({
  keyId: z.string().trim().regex(/^\d+$/),
})

export async function GET(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited

  const ctx = await validateManagementOrSessionAuth(request, 'read')
  if (!ctx) return createUnauthorizedResponse()

  try {
    const scopedTeamId = ctx.management?.teamId
    const teamScopedKeysEnabled = await isFeatureEnabled(
      TEAM_SCOPED_MANAGEMENT_KEYS_FLAG,
      ctx.user.id,
    )
    const rows = await prisma.betterAuthApiKey.findMany({
      where: {
        userId: ctx.user.id,
        // Keep existing team keys visible for revocation while rollout is off.
        // The flag hides team metadata and blocks both creation and use.
        prefix: { in: [MANAGEMENT_KEY_PREFIX, TEAM_MANAGEMENT_KEY_PREFIX] },
        ...(scopedTeamId ? { teamId: scopedTeamId } : {}),
      },
      orderBy: {
        createdAt: 'desc',
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
        team: {
          select: { id: true, title: true },
        },
      },
    })

    let teams: Awaited<ReturnType<typeof listManagementKeyTeams>> = []
    if (teamScopedKeysEnabled) {
      if (scopedTeamId) {
        const team = await getManagementKeyTeam(ctx.user.id, scopedTeamId)
        if (team) teams = [team]
      } else {
        teams = await listManagementKeyTeams(ctx.user.id)
      }
    }

    return NextResponse.json({
      success: true,
      keys: rows.map(({ prefix, ...row }) => ({
        ...row,
        id: String(row.id),
        permissions: parseManagementPermissions(row.permissions),
        teamScoped: prefix === TEAM_MANAGEMENT_KEY_PREFIX,
        team: teamScopedKeysEnabled ? row.team : null,
      })),
      teams,
    })
  } catch (error) {
    console.error('[Management Keys] Failed to list keys:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list management keys' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited

  const ctx = await validateManagementOrSessionAuth(request, 'write')
  if (!ctx) return createUnauthorizedResponse()

  try {
    const input = createKeySchema.parse(await request.json())
    const callerTeamId = ctx.management?.teamId
    if (callerTeamId && input.teamId && input.teamId !== callerTeamId) {
      return NextResponse.json(
        {
          success: false,
          error:
            'The authenticated management key cannot create a key for another team.',
        },
        { status: 403 },
      )
    }
    const teamId = callerTeamId ?? input.teamId
    let team: Awaited<ReturnType<typeof getManagementKeyTeam>> = null
    if (teamId) {
      const teamScopedKeysEnabled = await isFeatureEnabled(
        TEAM_SCOPED_MANAGEMENT_KEYS_FLAG,
        ctx.user.id,
      )
      if (!teamScopedKeysEnabled) {
        return NextResponse.json(
          {
            success: false,
            error: 'Team-scoped management keys are not enabled.',
          },
          { status: 403 },
        )
      }
      if (input.scope === 'full') {
        return NextResponse.json(
          {
            success: false,
            error: 'Full access is available only for whole-account keys.',
            reason: 'unsupported_scope',
          },
          { status: 400 },
        )
      }
      team = await getManagementKeyTeam(ctx.user.id, teamId)
      if (!team) {
        return NextResponse.json(
          { success: false, error: 'Team not found or access denied.' },
          { status: 403 },
        )
      }
      if (input.scope === 'usage' && !team.isOwner) {
        return NextResponse.json(
          {
            success: false,
            error: 'Usage keys can be limited only to teams you own.',
          },
          { status: 403 },
        )
      }
    }
    let permissions = MANAGEMENT_KEY_PERMISSIONS
    if (input.scope === 'full') {
      permissions = FULL_MANAGEMENT_KEY_PERMISSIONS
    } else if (input.scope === 'usage') {
      permissions = USAGE_READ_KEY_PERMISSIONS
    }

    let canGrant = true
    if (ctx.management) {
      if (input.scope === 'usage') {
        canGrant = hasUsageReadPermission(ctx.management.permissions)
      } else if (input.scope === 'full') {
        canGrant =
          isPermissionSubset(
            FULL_MANAGEMENT_KEY_PERMISSIONS,
            ctx.management.permissions,
          ) || hasLegacyFullPermissionShape(ctx.management.permissions)
      } else {
        canGrant = isPermissionSubset(permissions, ctx.management.permissions)
      }
    }

    if (!canGrant) {
      return NextResponse.json(
        {
          success: false,
          error:
            'The authenticated management key cannot grant the requested scope.',
          reason: 'insufficient_scope',
        },
        { status: 403 },
      )
    }

    const created = await auth.api.createApiKey({
      body: {
        name: input.name,
        userId: String(ctx.user.id),
        permissions,
        ...(teamId ? { prefix: TEAM_MANAGEMENT_KEY_PREFIX } : {}),
        ...(input.expiresInDays
          ? { expiresIn: input.expiresInDays * 24 * 60 * 60 }
          : {}),
      },
    })

    if (teamId) {
      try {
        const createdId = Number(created.id)
        if (!Number.isSafeInteger(createdId) || createdId <= 0) {
          throw new Error('Management key provider returned an invalid id')
        }
        const linked = await prisma.betterAuthApiKey.updateMany({
          where: {
            id: createdId,
            userId: ctx.user.id,
            prefix: TEAM_MANAGEMENT_KEY_PREFIX,
            teamId: null,
          },
          data: { teamId, teamAccessBinding: team!.accessBinding },
        })
        if (linked.count !== 1) {
          throw new Error('Failed to attach management key to team')
        }
      } catch (error) {
        try {
          await auth.api.updateApiKey({
            body: {
              keyId: String(created.id),
              userId: String(ctx.user.id),
              enabled: false,
            },
          })
        } catch (disableError) {
          console.error(
            '[Management Keys] Failed to disable an unlinked team key:',
            disableError,
          )
        }
        throw error
      }
    }

    return NextResponse.json(
      {
        success: true,
        key: created.key,
        apiKey: {
          id: created.id,
          name: created.name,
          start: created.start,
          permissions: parseManagementPermissions(created.permissions),
          enabled: created.enabled,
          lastRequest: created.lastRequest,
          expiresAt: created.expiresAt,
          createdAt: created.createdAt,
          teamScoped: Boolean(teamId),
          team: team ? { id: team.id, title: team.title } : null,
        },
        warning: 'Store this key securely. It will not be shown again.',
      },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', issues: error.issues },
        { status: 400 },
      )
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body' },
        { status: 400 },
      )
    }

    console.error('[Management Keys] Failed to create key:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create management key' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited

  const ctx = await validateManagementOrSessionAuth(request, 'write')
  if (!ctx) return createUnauthorizedResponse()

  try {
    const input = deleteKeySchema.parse(await request.json())
    const keyId = Number(input.keyId)
    const ownedKey = await prisma.betterAuthApiKey.findFirst({
      where: {
        id: keyId,
        userId: ctx.user.id,
        prefix: {
          in: [MANAGEMENT_KEY_PREFIX, TEAM_MANAGEMENT_KEY_PREFIX],
        },
        ...(ctx.management?.teamId ? { teamId: ctx.management.teamId } : {}),
      },
      select: {
        id: true,
      },
    })

    if (!ownedKey) {
      return NextResponse.json(
        { success: false, error: 'Management key not found' },
        { status: 404 },
      )
    }

    await auth.api.updateApiKey({
      body: {
        keyId: String(ownedKey.id),
        userId: String(ctx.user.id),
        enabled: false,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', issues: error.issues },
        { status: 400 },
      )
    }

    console.error('[Management Keys] Failed to disable key:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to disable management key' },
      { status: 500 },
    )
  }
}
