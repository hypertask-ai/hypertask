import type { NextRequest } from 'next/server'
import { validateMcpAuth } from '@/lib/mcp/auth'

export const AGENT_LISTING_REFUSAL =
  'Agents cannot list managed agent identities. Find an agent id with `hypertask projects members <board id>`, then put it to work with `hypertask task assign <ticket> --assignee <agent id>`, or assign yourself with `hypertask task assign <ticket> --self`.'

export async function isAgentTokenCaller(request: NextRequest): Promise<boolean> {
  if (!request.headers.has('Authorization')) return false
  const ctx = await validateMcpAuth(request, {
    deferManagementPermissionCheck: true,
  })
  return Boolean(ctx?.agentId)
}
