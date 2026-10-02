export type { McpAuthContext, AgentTokenTeamScope } from './auth/types'
export { managementAgentTokenScope } from './auth/types'
export {
  MANAGEMENT_KEY_PREFIX,
  isManagementKeyToken,
  extractBearerToken,
  validateMcpAuth,
  validateManagementAuth,
  validateUsageReadAuth,
  validateManagementOrSessionAuth,
} from './auth/session'
export type { ManagementAction } from './auth/session'
export { classifyMcpRateLimitCount, checkMcpRateLimit, resolveMcpRateLimit } from './auth/rateLimit'
export {
  JWT_MCP_AUDIENCE,
  JWT_LEGACY_MCP_AUDIENCE,
  legacyTokenRevocationJti,
  verifyMcpJwtToken,
  hashAgentToken,
  agentTokenCredentialFields,
  agentTokenMatchesStored,
  storedAgentTokenGeneration,
  presentedAgentTokenGeneration,
  createMcpToken,
  createOAuthToken,
  revokeTokenByJti,
  claimTokenRotation,
  revokeOwnedTokenByJti,
} from './auth/verifyJwt'
export type { McpUnauthorizedReason, McpAuthFailureLookup } from './auth/mcpAuthErrors'
export {
  MCP_LEGACY_TOKEN_MESSAGE,
  MCP_AGENT_REVOKED_MESSAGE,
  MCP_AGENT_TOKEN_SUPERSEDED_MESSAGE,
  MCP_AGENT_TOKEN_REFRESH_MESSAGE,
  createUnauthorizedResponse,
  classifyMcpAuthFailure,
  mcpUnauthorizedResponse,
} from './auth/mcpAuthErrors'
