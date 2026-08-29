import { z } from 'zod'

export function getListAgentsInputSchema() {
  return z.object({}).strict()
}

export const ListAgentsInputSchema = getListAgentsInputSchema()
export type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>
