import { withoutAuth } from "#with-auth";
import { handleRevokeAgentRequest } from '@/lib/mcp/agents/revoke'
import type { NextRequest } from 'next/server'

export const POST = withoutAuth((request: NextRequest) => handleRevokeAgentRequest(request))
