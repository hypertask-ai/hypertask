import { withoutAuth } from "#with-auth";
import { mcpHandler } from '@/lib/mcp-server/handler'

export const maxDuration = 800

export const GET = withoutAuth(mcpHandler)
export const POST = withoutAuth(mcpHandler)
export const DELETE = withoutAuth(mcpHandler)
