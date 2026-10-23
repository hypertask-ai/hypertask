import { prepareAgentScope } from "@/lib/auth/agentScope";
import { enqueueOutsideSaveAndProcessSoon } from "@/lib/telemetry/analyticsIntents";
import { enqueueAuthenticatedConnection } from "@/lib/telemetry/activationOccurrences";
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { hashApiKey } from '@/lib/apiKeys';
import { hasAnyManagementPermission, hasDataPermission, hasManagementReadPermission, hasManagementWritePermission, hasUsageReadPermission, parseManagementPermissions } from '@/lib/mcp/managementPermissions';
import { logMcpCliUsage } from '@/lib/mcp/clientTelemetry';
import { HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG, isFeatureEnabled } from '@/lib/flags';
import { ACCOUNT_MANAGEMENT_KEY_PREFIX, getManagementKeyTeam, TEAM_MANAGEMENT_KEY_PREFIX } from '@/lib/mcp/managementKeyTeamScope';
import { JWT_MCP_AUDIENCE, validateJwtToken, boundedMcpAuthLog } from './verifyJwt';
import type { McpAuthContext, ValidateMcpAuthOptions } from './types';
import { getMcpOperationContext } from '../operationContext';

export const MANAGEMENT_KEY_PREFIX = ACCOUNT_MANAGEMENT_KEY_PREFIX
export const isManagementKeyToken = (token: string) =>
  token.startsWith(MANAGEMENT_KEY_PREFIX) ||
  token.startsWith(TEAM_MANAGEMENT_KEY_PREFIX)
export function extractBearerToken(authHeader: string | null): string | null {
  return authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
}

export async function validateMcpAuth(request: NextRequest, options: ValidateMcpAuthOptions = {}): Promise<McpAuthContext | null> {
  const ctx = await readMcpAuth(request, options);
  if (ctx) await prepareAgentScope(ctx.user.id, ctx.agentId);
  return ctx;
}

async function readMcpAuth(
  request: NextRequest,
  options: ValidateMcpAuthOptions = {}
): Promise<McpAuthContext | null> {
  const operationContext = getMcpOperationContext(request)
  if (operationContext) {
    const ctx = operationContext.auth
    if (ctx.management && !options.deferManagementPermissionCheck &&
      !hasDataPermission(ctx.management.permissions)) return null
    return ctx
  }
  const token = extractBearerToken(request.headers.get('Authorization'))

  if (!token) {
    console.log('[MCP Auth] No Authorization header or invalid format')
    return null
  }

  if (isManagementKeyToken(token)) {
    const managementCtx = await validateManagementApiKey(token)
    if (!managementCtx) {
      console.log('[MCP Auth] Management API key validation failed')
      return null
    }
    if (
      !options.deferManagementPermissionCheck &&
      !hasDataPermission(managementCtx.management?.permissions ?? {})
    ) {
      console.log('[MCP Auth] Management API key rejected:', {
        reason: 'insufficient_scope',
      })
      return null
    }

    console.log('[MCP Auth] Management API key validated for user:', managementCtx.user.id)
    await enqueueOutsideSaveAndProcessSoon(() => enqueueAuthenticatedConnection(prisma, request, managementCtx.user.id, token, undefined, `management_key:${managementCtx.management!.keyId}`))
    logMcpCliUsage(request, token, managementCtx)
    return managementCtx
  }

  if (token.startsWith('htk_')) {
    const validated = await validateApiKey(token)
    if (validated) {
      const { context: ctx, keyId } = validated
      console.log('[MCP Auth] API key validated for user:', ctx.user.id)
      await enqueueOutsideSaveAndProcessSoon(() => enqueueAuthenticatedConnection(prisma, request, ctx.user.id, token, undefined, `api_key:${keyId}`))
      logMcpCliUsage(request, token, ctx)
      return ctx
    }

    console.log('[MCP Auth] API key validation failed')
    return null
  }

  const connectedAt = new Date()
  const ctx = await validateJwtToken(token, options)
  if (ctx) {
    const log = options.boundedLogging ? boundedMcpAuthLog : console.log
    log('[MCP Auth] JWT validated for user:', ctx.user.id, 'agentId:', ctx.agentId ?? '(none)')
    await enqueueOutsideSaveAndProcessSoon(() => enqueueAuthenticatedConnection(prisma, request, ctx.user.id, token, connectedAt, ctx.agentId ? `agent:${ctx.agentId}` : undefined))
    logMcpCliUsage(request, token, ctx, options.boundedLogging ? boundedMcpAuthLog : undefined)
    return ctx
  }

  if (options.boundedLogging) boundedMcpAuthLog('[MCP Auth] JWT token validation failed')
  else console.log('[MCP Auth] JWT token validation failed')
  return null
}

async function validateApiKey(token: string): Promise<{ context: McpAuthContext; keyId: string } | null> {
  try {
    const keyHash = hashApiKey(token)
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        keyHash,
        revokedAt: null,
      },
      select: {
        id: true,
        lastUsedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    })

    if (!apiKey?.user) {
      return null
    }

    const now = new Date()
    const lastUsedCutoff = new Date(now.getTime() - 5 * 60 * 1000)
    if (!apiKey.lastUsedAt || apiKey.lastUsedAt < lastUsedCutoff) {
      void prisma.apiKey.updateMany({
        where: {
          id: apiKey.id,
          OR: [
            { lastUsedAt: null },
            { lastUsedAt: { lt: lastUsedCutoff } },
          ],
        },
        data: {
          lastUsedAt: now,
        },
      }).catch(() => undefined)
    }

    return {
      keyId: String(apiKey.id),
      context: {
        user: {
          id: apiKey.user.id,
          email: apiKey.user.email,
          displayName: apiKey.user.displayName ?? undefined,
        },
        agentId: null,
        teamScope: null,
      },
    }
  } catch {
    console.log('[MCP Auth] API key lookup failed')
    return null
  }
}

export type ManagementAction = 'read' | 'write' | 'usage:read'

export async function validateManagementAuth(
  request: NextRequest,
  requiredAction?: ManagementAction
): Promise<McpAuthContext | null> {
  const token = extractBearerToken(request.headers.get('Authorization'))

  if (!token) {
    console.log('[MCP Auth] No Authorization header or invalid format')
    return null
  }

  if (isManagementKeyToken(token)) {
    const managementCtx = getMcpOperationContext(request)?.auth ?? await validateManagementApiKey(token)
    const permissions = managementCtx?.management?.permissions ?? {}
    let hasRequiredPermission = hasAnyManagementPermission(permissions)
    if (requiredAction === 'write') {
      hasRequiredPermission = hasManagementWritePermission(permissions)
    } else if (requiredAction === 'read') {
      hasRequiredPermission = hasManagementReadPermission(permissions)
    } else if (requiredAction === 'usage:read') {
      hasRequiredPermission = hasUsageReadPermission(permissions)
    }
    if (
      !managementCtx ||
      !hasRequiredPermission
    ) {
      console.log('[MCP Auth] Management API key lacks required management permission', {
        requiredAction: requiredAction ?? 'any',
      })
      return null
    }

    logMcpCliUsage(request, token, managementCtx)
    return managementCtx
  }

  if (requiredAction === 'usage:read') return null

  const unverified = jwt.decode(token) as jwt.JwtPayload | null
  const aud = unverified?.aud
  const audiences = Array.isArray(aud) ? aud : aud ? [aud] : []
  if (!audiences.includes(JWT_MCP_AUDIENCE)) {
    console.log('[MCP Auth] Management endpoints require an mcp-api audience token')
    return null
  }

  const ctx = getMcpOperationContext(request)?.auth ?? await validateJwtToken(token)
  if (!ctx) return null
  if (ctx.agentId) {
    console.log('[MCP Auth] Agent tokens cannot access management endpoints')
    return null
  }
  logMcpCliUsage(request, token, ctx)
  return ctx
}

export async function validateUsageReadAuth(
  request: NextRequest
): Promise<McpAuthContext | null> {
  const token = extractBearerToken(request.headers.get('Authorization'))
  if (!token) return null
  if (!isManagementKeyToken(token)) return null

  return validateManagementAuth(request, 'usage:read')
}

export async function validateManagementOrSessionAuth(
  request: NextRequest,
  requiredAction?: ManagementAction
): Promise<McpAuthContext | null> {
  const managementCtx = await validateManagementAuth(request, requiredAction)
  if (managementCtx) return managementCtx

  if (request.headers.has('Authorization')) return null

  const { getSessionUser } = await import('@/lib/auth/getSessionUser')
  const session = await getSessionUser(request.headers)
  if (!session || session.agentId) return null

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  })
  if (!user) return null

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? undefined,
    },
    agentId: null,
    teamScope: null,
  }
}

export async function validateManagementApiKey(token: string): Promise<McpAuthContext | null> {
  try {
    const { auth } = await import('@/lib/auth/betterAuth')
    const result = await auth.api.verifyApiKey({
      body: {
        key: token,
      },
    })

    if (!result.valid || !result.key) return null

    const userId = Number(result.key.referenceId)
    if (!Number.isInteger(userId) || userId <= 0) return null

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    })
    if (!user) return null

    const keyPrefix = result.key.prefix
    if (
      keyPrefix !== ACCOUNT_MANAGEMENT_KEY_PREFIX &&
      keyPrefix !== TEAM_MANAGEMENT_KEY_PREFIX
    ) {
      return null
    }

    let teamId: string | undefined
    let teamAccessBinding: string | undefined
    if (keyPrefix === TEAM_MANAGEMENT_KEY_PREFIX) {
      if (
        !(await isFeatureEnabled(
          HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG,
          user.id
        ))
      ) {
        return null
      }

      const keyId = Number(result.key.id)
      if (!Number.isSafeInteger(keyId) || keyId <= 0) return null
      const keyRow = await prisma.betterAuthApiKey.findFirst({
        where: {
          id: keyId,
          userId: user.id,
          prefix: TEAM_MANAGEMENT_KEY_PREFIX,
          enabled: true,
        },
        select: { teamId: true, teamAccessBinding: true },
      })
      if (!keyRow?.teamId || !keyRow.teamAccessBinding) return null

      const team = await getManagementKeyTeam(user.id, keyRow.teamId)
      if (!team || team.accessBinding !== keyRow.teamAccessBinding) {
        await prisma.betterAuthApiKey.updateMany({
          where: { id: keyId, userId: user.id, enabled: true },
          data: { enabled: false },
        })
        return null
      }
      teamId = team.id
      teamAccessBinding = team.accessBinding
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName ?? undefined,
      },
      agentId: null,
      teamScope: teamId && teamAccessBinding ? { teamId, accessBinding: teamAccessBinding } : null,
      management: {
        keyId: String(result.key.id),
        permissions: parseManagementPermissions(result.key.permissions),
        ...(teamId ? { teamId, teamAccessBinding } : {}),
      },
    }
  } catch (error) {
    console.error('[MCP Auth] Failed to verify management API key:', error)
    return null
  }
}
