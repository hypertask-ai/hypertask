import { z } from 'zod'
import { paginationSchema } from './common/pagination'
import { type ListQuerySchemaOptions, withListQuerySchema } from './common/listQuery'

export function getListAgentsInputSchema(options?: ListQuerySchemaOptions) {
  if (!options?.listQuery) return z.object({}).strict()
  return withListQuerySchema(z.object({}), { listQuery: true }).merge(paginationSchema).strict()
}

export const ListAgentsInputSchema = getListAgentsInputSchema({ listQuery: true })
export type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>
