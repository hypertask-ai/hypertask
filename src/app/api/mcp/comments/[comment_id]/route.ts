import { PATCH as executePATCH, DELETE as executeDELETE } from '@/lib/mcp/operations/comments/[comment_id]/operation'

export const PATCH = executePATCH
export const DELETE = executeDELETE
export type { McpMentionInput, UpdateCommentRequest, UpdateCommentResponse } from '@/lib/mcp/operations/comments/[comment_id]/operation'
