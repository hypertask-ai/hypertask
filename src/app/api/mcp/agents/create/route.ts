import { handleCreateAgentRequest } from '@/lib/mcp/agents/create'
import type { NextRequest } from 'next/server'

export const POST = (request: NextRequest) => handleCreateAgentRequest(request)
