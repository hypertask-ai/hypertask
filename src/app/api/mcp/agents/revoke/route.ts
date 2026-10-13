import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { handleRevokeAgentRequest } from '@/lib/mcp/agents/revoke'
import type { NextRequest } from 'next/server'

export const POST = wrapMcpRoute((request: NextRequest) => handleRevokeAgentRequest(request))