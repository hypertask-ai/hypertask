import { withoutAuth } from "#with-auth";
import { handleRotateAgentTokenRequest } from '@/lib/mcp/agents/rotateToken'
import type { NextRequest } from 'next/server'

export const POST = withoutAuth((request: NextRequest) =>
  handleRotateAgentTokenRequest(request))
