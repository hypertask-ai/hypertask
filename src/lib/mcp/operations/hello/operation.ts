import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { handleHelloRequest } from '@/lib/mcp/hello/getHelloPayload'

export const GET = wrapMcpRoute(handleHelloRequest)
export const POST = wrapMcpRoute(handleHelloRequest)
