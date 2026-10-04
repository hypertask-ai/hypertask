import { POST as executePOST, GET as executeGET } from '@/lib/mcp/operations/projects/[projectId]/sections/operation'

export const POST = executePOST
export const GET = executeGET
export type { SectionListItem, ListSectionsResponse, CreateSectionSuccessResponse } from '@/lib/mcp/operations/projects/[projectId]/sections/operation'
