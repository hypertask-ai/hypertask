import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { handleRotateAgentTokenRequest } from '@/lib/mcp/agents/rotateToken'
import type { NextRequest } from 'next/server'

export const POST = wrapMcpRoute((request: NextRequest) =>
  handleRotateAgentTokenRequest(request))