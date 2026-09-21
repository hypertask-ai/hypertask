import { withoutAuth } from "#with-auth";
import { handleCreateAgentRequest } from '@/lib/mcp/agents/create'
import type { NextRequest } from 'next/server'

export const POST = withoutAuth((request: NextRequest) => handleCreateAgentRequest(request))
