import { GET as executeGET, POST as executePOST, DELETE as executeDELETE, PATCH as executePATCH } from '@/lib/mcp/operations/agents/[agentId]/operation'

export const { GET } = { GET: executeGET }
export const POST = executePOST
export const DELETE = executeDELETE
export const PATCH = executePATCH
