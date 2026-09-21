import { handleRotateAgentTokenRequest } from '@/lib/mcp/agents/rotateToken'
import type { NextRequest } from 'next/server'

export const POST = (request: NextRequest) =>
  handleRotateAgentTokenRequest(request)
