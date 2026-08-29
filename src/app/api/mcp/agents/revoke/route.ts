import { handleRevokeAgentRequest } from '@/lib/mcp/agents/revoke'
import type { NextRequest } from 'next/server'

export const POST = (request: NextRequest) => handleRevokeAgentRequest(request)
