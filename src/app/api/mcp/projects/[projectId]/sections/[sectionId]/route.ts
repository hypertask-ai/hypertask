import { PATCH as executePATCH, DELETE as executeDELETE } from '@/lib/mcp/operations/projects/[projectId]/sections/[sectionId]/operation'

export const PATCH = executePATCH
export const DELETE = executeDELETE
export type { SectionListItem } from '@/lib/mcp/operations/projects/[projectId]/sections/[sectionId]/operation'
