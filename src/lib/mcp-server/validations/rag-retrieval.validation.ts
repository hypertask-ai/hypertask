import { z } from 'zod'

export function getRagRetrievalBaseSchema() {
  return z.object({
    query: z.string().min(1).max(500),
    project_id: z.coerce.number().int().positive().optional(),
    metadata_filters: z.record(z.string(), z.unknown()).optional(),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  })
}

export const RagRetrievalInputSchema = getRagRetrievalBaseSchema()
export type RagRetrievalInput = z.infer<typeof RagRetrievalInputSchema>
