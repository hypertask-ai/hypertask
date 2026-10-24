import prisma from '@/lib/prisma'
import { resolveAgentTeamScope } from '@/lib/auth/agentTeamScope'
import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types'
import { prepareAgentScope } from "@/lib/auth/agentScope";
import { parseCookies } from 'better-auth/cookies'

import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import { isSessionTokenRevoked } from '@/lib/auth/sessionRevocation'

export type SessionUser = { teamScope: AgentTokenTeamScope | null; agentTokenGeneration?: string | null } & (
  | { userId: number; agentId?: string; source: 'better-auth' }
  | { userId: number; agentId?: string; source: 'legacy'; needsBridge: true }
  | { userId: number; agentId?: never; source: 'cli-bearer' })

export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const session = await readSessionUser(headers);
  if (session) await prepareAgentScope(session.userId, session.agentId);
  return session;
}

async function readSessionUser(headers: Headers): Promise<SessionUser | null> {
  const cookieHeader = headers.get('cookie')
  const token = cookieHeader
    ? parseCookies(cookieHeader).get(SESSION_COOKIE)
    : undefined
  const legacySession = verifySession(token)
  if (legacySession && await isSessionTokenRevoked(token, { failClosed: false })) {
    return null
  }

  if (legacySession?.agentId) {
    try {
      const agent = await prisma.agent.findFirst({
        where: { id: legacySession.agentId, userId: legacySession.id, revokedAt: null },
        select: { credentialTeamId: true, credentialTeamAccessBinding: true, mcpTokenJti: true },
      })
      if (!agent) return null
      if (legacySession.agentTokenGeneration != null && legacySession.agentTokenGeneration !== agent.mcpTokenJti) return null
      const teamScope = await resolveAgentTeamScope(legacySession.id, agent)
      if (legacySession.teamScope != null &&
        (teamScope?.teamId !== legacySession.teamScope.teamId || teamScope.accessBinding !== legacySession.teamScope.accessBinding)) return null
      return { userId: legacySession.id, agentId: legacySession.agentId, teamScope, agentTokenGeneration: agent.mcpTokenJti, source: 'legacy', needsBridge: true }
    } catch {
      return null
    }
  }
  if (process.env.AUTH_LEGACY_FAST_PATH === '1' && legacySession) {
    return { teamScope: null, userId: legacySession.id, ...(legacySession.agentId ? { agentId: legacySession.agentId } : {}), source: 'legacy', needsBridge: true }
  }

  if (process.env.BETTER_AUTH_ENABLED === '1') {
    let session: Awaited<ReturnType<typeof import('@/lib/auth/betterAuth').auth.api.getSession>> | null
    try {
      const { auth } = await import('@/lib/auth/betterAuth')
      session = await auth.api.getSession({ headers })
    } catch {
      session = null
    }
    if (session && session.user && typeof session.user === 'object') {
      const userId = Number(session.user.id)
      if (Number.isFinite(userId)) {
        if (legacySession && legacySession.id !== userId) {
          return { teamScope: null, userId: legacySession.id, source: 'legacy', needsBridge: true }
        }
        return { userId, teamScope: null, source: 'better-auth' }
      }
    }
  }

  if (!legacySession) {
    return null
  }

  return {
    userId: legacySession.id,
    teamScope: null,
    source: 'legacy',
    needsBridge: true,
  }
}
