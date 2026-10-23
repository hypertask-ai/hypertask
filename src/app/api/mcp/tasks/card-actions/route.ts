import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { POST as handlePost } from '@/lib/mcp/tasks/cardActionHandler'

export const POST = wrapMcpRoute(handlePost)
