import { GET as executeGET, PATCH as executePATCH, DELETE as executeDELETE } from '@/lib/mcp/operations/view/[viewId]/operation'

export const GET = executeGET
export const PATCH = executePATCH
export const DELETE = executeDELETE
export type { AppliedViewItem, GetViewResponse } from '@/lib/mcp/operations/view/[viewId]/operation'
