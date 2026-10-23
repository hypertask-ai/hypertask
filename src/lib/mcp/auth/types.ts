import type { AgentRole } from '@/lib/mcp/agents/scopes'

export type McpAuthContext = {
  user: { id: number; email: string; displayName?: string | null }
  teamScope: AgentTokenTeamScope | null
  agentId: string | null
  agentRole?: AgentRole
  agentDisplayName?: string | null
  agentTokenGeneration?: string | null
  agentRuntimeGeneration?: number | null
  management?: {
    keyId: string
    permissions: Record<string, string[]>
    teamId?: string
    teamAccessBinding?: string
  }
}

export type AgentTokenTeamScope = {
  teamId: string
  accessBinding: string
}

export function managementAgentTokenScope(
  management: McpAuthContext['management']
): AgentTokenTeamScope | undefined {
  if (!management?.teamId) return undefined
  if (!management.teamAccessBinding) {
    throw new Error('Team-scoped management context has no access binding')
  }
  return {
    teamId: management.teamId,
    accessBinding: management.teamAccessBinding,
  }
}

export type McpAuthFailureSnapshot = {
  verifiedJwt?: import('jsonwebtoken').JwtPayload | null
  user?: { id: number; mcpTokensRevokedAt: Date | null } | null
  revokedToken?: { jti: string } | null
  oauthClient?: { client_id: string } | null
  agent?: { id: string; mcpTokenJti: string | null; revokedAt: Date | null }
}

export type McpAuthTimings = { jwtMs?: number; dbMs?: number }

export type ValidateMcpAuthOptions = {
  boundedLogging?: boolean
  failureSnapshot?: McpAuthFailureSnapshot
  timings?: McpAuthTimings
  deferManagementPermissionCheck?: boolean
}
