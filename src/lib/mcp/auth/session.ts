import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { hashApiKey } from '@/lib/apiKeys';
import { auth } from '@/lib/auth/betterAuth';
import { getSessionUser } from '@/lib/auth/getSessionUser';
import { hasAnyManagementPermission, hasDataPermission, hasManagementReadPermission, hasManagementWritePermission, hasUsageReadPermission, parseManagementPermissions } from '@/lib/mcp/managementPermissions';
import { logMcpCliUsage } from '@/lib/mcp/clientTelemetry';
import { HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG, isFeatureEnabled } from '@/lib/flags';
import { ACCOUNT_MANAGEMENT_KEY_PREFIX, getManagementKeyTeam, TEAM_MANAGEMENT_KEY_PREFIX } from '@/lib/mcp/managementKeyTeamScope';
import { JWT_MCP_AUDIENCE, validateJwtToken } from './verifyJwt';
import type { McpAuthContext, ValidateMcpAuthOptions } from './types';
import { getMcpOperationContext } from '../operationContext';

export const MANAGEMENT_KEY_PREFIX = ACCOUNT_MANAGEMENT_KEY_PREFIX
export const isManagementKeyToken = (token: string) =>
  token.startsWith(MANAGEMENT_KEY_PREFIX) ||
  token.startsWith(TEAM_MANAGEMENT_KEY_PREFIX)
export function extractBearerToken(authHeader: string | null): string | null {
  return authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
}

/**
 * Unified authentication for MCP routes
 * Supports both JWT tokens and API keys
 * 
 * JWT Tokens (Recommended):
 * - Stateless, no database lookup needed (faster)
 * - Contains user info in token
 * - Can be longer-lived (30 days) for MCP use case
 * - Already have infrastructure set up
 * 
 * API Keys (Alternative):
 * - Database-backed, can track usage
 * - Can be scoped to permissions
 * - Can have multiple keys per user
 * - Better for service-to-service communication
 * 
 * @param request NextRequest object
 * @returns User + optional agentId, or null if invalid
 */
export async function validateMcpAuth(
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
    logMcpCliUsage(request, token, managementCtx)
    return managementCtx
  }

  if (token.startsWith('htk_')) {
    const ctx = await validateApiKey(token)
    if (ctx) {
      console.log('[MCP Auth] API key validated for user:', ctx.user.id)
      logMcpCliUsage(request, token, ctx)
      return ctx
    }

    console.log('[MCP Auth] API key validation failed')
    return null
  }

  const ctx = await validateJwtToken(token)
  if (ctx) {
    console.log('[MCP Auth] JWT validated for user:', ctx.user.id, 'agentId:', ctx.agentId ?? '(none)')
    logMcpCliUsage(request, token, ctx)
    return ctx
  }

  console.log('[MCP Auth] JWT token validation failed')
  return null
}

async function validateApiKey(token: string): Promise<McpAuthContext | null> {
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
      user: {
        id: apiKey.user.id,
        email: apiKey.user.email,
        displayName: apiKey.user.displayName ?? undefined,
      },
      agentId: null,
    }
  } catch {
    console.log('[MCP Auth] API key lookup failed')
    return null
  }
}

/**
 * Authentication for account-management MCP routes. A regular MCP JWT can
 * bootstrap the first key; subsequent calls may use an htmk_ management key.
 */
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

  // Usage reports are intentionally management-key-only. Do not let a regular
  // MCP JWT reach the generic JWT branch when this action is requested.
  if (requiredAction === 'usage:read') return null

  // Management endpoints accept only real MCP tokens (aud mcp-api). The same
  // JWT_SECRET signs calendar-feed/email-link tokens, and validateJwtToken
  // keeps a legacy no-audience fallback for old MCP clients - without this
  // gate any same-secret JWT could mint a persistent management key.
  const unverified = jwt.decode(token) as jwt.JwtPayload | null
  const aud = unverified?.aud
  const audiences = Array.isArray(aud) ? aud : aud ? [aud] : []
  if (!audiences.includes(JWT_MCP_AUDIENCE)) {
    console.log('[MCP Auth] Management endpoints require an mcp-api audience token')
    return null
  }

  const ctx = getMcpOperationContext(request)?.auth ?? await validateJwtToken(token)
  if (!ctx) return null
  // Agent-bound JWTs are data credentials for bots; letting one mint or
  // revoke keys would escalate a leaked bot token to account admin.
  if (ctx.agentId) {
    console.log('[MCP Auth] Agent tokens cannot access management endpoints')
    return null
  }
  logMcpCliUsage(request, token, ctx)
  return ctx
}

/**
 * Usage is an account-owner management-key surface, not a general MCP data
 * surface. Keep regular MCP JWTs, data keys, and browser sessions out.
 */
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

  // A presented credential is the selected principal. Do not silently upgrade
  // an invalid, under-scoped, data-key, or agent credential through an ambient
  // browser session. Session auth is a fallback only when no bearer was sent.
  if (request.headers.has('Authorization')) return null

  const session = await getSessionUser(request.headers)
  if (!session) return null

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
  }
}

export async function validateManagementApiKey(token: string): Promise<McpAuthContext | null> {
  try {
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
