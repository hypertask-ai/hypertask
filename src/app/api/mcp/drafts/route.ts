import { POST as executePOST, GET as executeGET } from '@/lib/mcp/operations/drafts/operation'

export const POST = executePOST
export const GET = executeGET
export type { DraftItem, CreateDraftResponse, ListDraftsResponse } from '@/lib/mcp/operations/drafts/operation'
