import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { handleCreateAgentRequest } from '@/lib/mcp/agents/create'
import type { NextRequest } from 'next/server'

export const POST = wrapMcpRoute((request: NextRequest) => handleCreateAgentRequest(request))