import { withoutAuth } from "#with-auth";
import { handleHelloRequest } from '@/lib/mcp/hello/getHelloPayload'

export const GET = withoutAuth(handleHelloRequest)
export const POST = withoutAuth(handleHelloRequest)
