import { z } from 'zod'
import { paginationSchema } from './common/pagination'
import { type ListQuerySchemaOptions, withListQuerySchema } from './common/listQuery'

export function getListAgentsInputSchema(options?: ListQuerySchemaOptions) {
  return withListQuerySchema(z.object({}), options).merge(paginationSchema).strict()
}

export const ListAgentsInputSchema = getListAgentsInputSchema({ listQuery: true })
export type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>
