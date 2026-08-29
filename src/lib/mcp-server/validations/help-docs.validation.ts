import { z } from 'zod';

export function getSearchHelpDocsBaseSchema() {
  return z.object({
    query: z.string().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(6).default(4),
  });
}

export const SearchHelpDocsInputSchema = getSearchHelpDocsBaseSchema();
export type SearchHelpDocsInput = z.infer<typeof SearchHelpDocsInputSchema>;
