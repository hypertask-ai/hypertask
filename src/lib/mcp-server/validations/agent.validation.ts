import { z } from 'zod'
import { paginationSchema } from './common/pagination'
import { withListQuerySchema } from './common/listQuery'

export function getListAgentsInputSchema() {
  return withListQuerySchema(z.object({})).merge(paginationSchema).strict()
}

export const ListAgentsInputSchema = getListAgentsInputSchema()
export type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>
