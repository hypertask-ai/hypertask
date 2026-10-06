import { z } from "zod";

const id = z.number().int().positive();
export const createSectionBodySchema = z.object({
  projectId: id,
  title: z.string(),
  ranking: z.string().optional(),
});
// Delete sends the full cached section; rename and reorder send only their patch.
export const updateSectionBodySchema = z.object({
  userId: id.optional(),
  sectionId: id.optional(),
  newSection: z.looseObject({
    section_title: z.string().optional(),
    ranking: z.string().optional(),
    deleted: z.boolean().optional(),
    visibility: z.boolean().optional(),
    isDone: z.boolean().nullable().optional(),
  }),
});
export const sectionResponseSchema = z.looseObject({
  id,
  projectId: id,
  section_title: z.string(),
  visibility: z.boolean(),
  deleted: z.boolean(),
  ranking: z.string(),
  isDone: z.boolean().nullable(),
});
export const createSectionResponseSchema = z.looseObject({
  message: z.literal("Section created successfully"),
  section: sectionResponseSchema,
  project_view: z.looseObject({ id: z.string(), projectId: id }).nullable(),
});
// Next strips the service's JSON on 204; Axios exposes the empty wire body as "".
export const updateSectionResponseSchema = z.union([sectionResponseSchema, z.literal("")]);
export const sectionWriteErrorSchema = z.looseObject({ message: z.string() });
// Creation can pass through a raw service error on 500.
export const sectionCreateServerErrorSchema = z.looseObject({});

export type CreateSectionBody = z.input<typeof createSectionBodySchema>;
export type UpdateSectionBody = z.input<typeof updateSectionBodySchema>;
