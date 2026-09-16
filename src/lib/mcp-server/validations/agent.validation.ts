import { z } from 'zod'
import { paginationSchema } from './common/pagination'
import { listQueryToolSchema } from './common/listQuery'

export function getListAgentsInputSchema() {
  return z.object({}).merge(listQueryToolSchema).merge(paginationSchema).strict()
}

export const ListAgentsInputSchema = getListAgentsInputSchema()
export type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>
