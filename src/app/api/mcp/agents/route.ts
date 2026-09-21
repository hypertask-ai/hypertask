import { handleListAgentsRequest } from '@/lib/mcp/agents/list'
import type { NextRequest } from 'next/server'

export const GET = (request: NextRequest) => handleListAgentsRequest(request)
