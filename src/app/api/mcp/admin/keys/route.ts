import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth/betterAuth'
import {
  checkMcpRateLimit,
  createUnauthorizedResponse,
  validateManagementOrSessionAuth,
} from '@/lib/mcp/auth'
import {
  FULL_MANAGEMENT_KEY_PERMISSIONS,
  hasLegacyFullPermissionShape,
  hasUsageReadPermission,
  isPermissionSubset,
  MANAGEMENT_KEY_PERMISSIONS,
  parseManagementPermissions,
  USAGE_READ_KEY_PERMISSIONS,
} from '@/lib/mcp/managementPermissions'
import prisma from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(32),
  scope: z.enum(['management', 'usage', 'full']).default('management'),
  expiresInDays: z.number().int().min(1).max(365).optional(),
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
    const rows = await prisma.betterAuthApiKey.findMany({
      where: {
        userId: ctx.user.id,
        prefix: 'htmk_',
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
      },
    })

    return NextResponse.json({
      success: true,
      keys: rows.map((row) => ({
        ...row,
        id: String(row.id),
        permissions: parseManagementPermissions(row.permissions),
      })),
    })
  } catch (error) {
    console.error('[Management Keys] Failed to list keys:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list management keys' },
      { status: 500 }
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
            ctx.management.permissions
          ) ||
          hasLegacyFullPermissionShape(ctx.management.permissions)
      } else {
        canGrant = isPermissionSubset(permissions, ctx.management.permissions)
      }
    }

    if (!canGrant) {
      return NextResponse.json(
        {
          success: false,
          error: 'The authenticated management key cannot grant the requested scope.',
          reason: 'insufficient_scope',
        },
        { status: 403 }
      )
    }

    const created = await auth.api.createApiKey({
      body: {
        name: input.name,
        userId: String(ctx.user.id),
        permissions,
        ...(input.expiresInDays
          ? { expiresIn: input.expiresInDays * 24 * 60 * 60 }
          : {}),
      },
    })

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
        },
        warning: 'Store this key securely. It will not be shown again.',
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', issues: error.issues },
        { status: 400 }
      )
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body' },
        { status: 400 }
      )
    }

    console.error('[Management Keys] Failed to create key:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create management key' },
      { status: 500 }
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
        prefix: 'htmk_',
      },
      select: {
        id: true,
      },
    })

    if (!ownedKey) {
      return NextResponse.json(
        { success: false, error: 'Management key not found' },
        { status: 404 }
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
        { status: 400 }
      )
    }

    console.error('[Management Keys] Failed to disable key:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to disable management key' },
      { status: 500 }
    )
  }
}
