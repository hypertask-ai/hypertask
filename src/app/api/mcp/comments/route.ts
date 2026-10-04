import { GET as executeGET, POST as executePOST } from '@/lib/mcp/operations/comments/operation'

export const GET = executeGET
export const POST = executePOST
export type { CommentItem, ListCommentsResponse, McpMentionInput, AddCommentRequest, AddCommentResponse } from '@/lib/mcp/operations/comments/operation'
