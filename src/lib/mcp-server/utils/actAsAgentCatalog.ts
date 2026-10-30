import { HTPR_7529_MCP_ACT_AS_AGENT_FLAG, isFeatureEnabled } from '@/lib/flags'
import type { McpAuthContext } from '@/lib/mcp/auth/types'

export async function actAsAgentAvailable(ctx: McpAuthContext): Promise<boolean> {
  if (ctx.agentId || ctx.management) return false
  return isFeatureEnabled(HTPR_7529_MCP_ACT_AS_AGENT_FLAG, ctx.user.id).catch(() => false)
}
