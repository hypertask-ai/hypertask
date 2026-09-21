import { withoutAuth } from "#with-auth";
import { handleListAgentsRequest } from "@/utils/controllers/agents"
import type { NextRequest } from 'next/server'

export const GET = withoutAuth((request: NextRequest) => handleListAgentsRequest(request))
