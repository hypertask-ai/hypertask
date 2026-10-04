import { GET as executeGET, POST as executePOST } from '@/lib/mcp/operations/view/operation'

export const GET = executeGET
export const POST = executePOST
export type { ListViewItem, ListViewsResponse, CreateViewResponse } from '@/lib/mcp/operations/view/operation'
