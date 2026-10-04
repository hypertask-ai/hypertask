import { GET as executeGET, PATCH as executePATCH, DELETE as executeDELETE } from '@/lib/mcp/operations/skills/[skill_id]/operation'

export const GET = executeGET
export const PATCH = executePATCH
export const DELETE = executeDELETE
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
