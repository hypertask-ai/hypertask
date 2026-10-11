/** MCP session: human principal + optional agent actor (null = user acts as themselves). */
export type McpAuthContext = {
  user: { id: number; email: string; displayName?: string | null }
  agentId: string | null
  /** Runtime generation observed while the managed agent token was verified. */
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

/** Milliseconds spent verifying the JWT and in the auth database reads (HTPR-6965). */
export type McpAuthTimings = { jwtMs?: number; dbMs?: number }

export type ValidateMcpAuthOptions = {
  /** Opt-in REST wrapper logging and request-local verification reuse. */
  boundedLogging?: boolean
  failureSnapshot?: McpAuthFailureSnapshot
  /** Measurement only (Server-Timing); never changes the result. */
  timings?: McpAuthTimings
  /**
   * Return a verified htmk_ context without requiring data scope. The caller
   * must enforce the management permission before performing any action.
   */
  deferManagementPermissionCheck?: boolean
}
