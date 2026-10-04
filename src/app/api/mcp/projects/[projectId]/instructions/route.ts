import { GET as executeGET, PUT as executePUT } from '@/lib/mcp/operations/projects/[projectId]/instructions/operation'

export const GET = executeGET
export const PUT = executePUT
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
