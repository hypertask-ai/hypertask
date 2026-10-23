import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { handleListAgentsRequest } from '@/lib/mcp/agents/list'
import type { NextRequest } from 'next/server'

export const GET = wrapMcpRoute((request: NextRequest) => handleListAgentsRequest(request))