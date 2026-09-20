import { handleListAgentsRequest } from "@/utils/controllers/agents"
import type { NextRequest } from 'next/server'

export const GET = (request: NextRequest) => handleListAgentsRequest(request)
