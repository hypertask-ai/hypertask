import { z } from "zod";

export const boardMemoryQuerySchema = z.object({
  projectId: z.coerce.number().int().positive(),
});

export const boardMemoryResponseSchema = z.looseObject({
  enabled: z.boolean(),
  memories: z.array(z.looseObject({
    content: z.string(),
    createdAt: z.string(),
    source: z.string(),
  })),
});

export const skillsListQuerySchema = z.object({
  projectId: z.union([z.number(), z.string()])
    .transform((value) => value === "" ? undefined : Number(value))
    .pipe(z.number().int().positive().optional())
    .optional(),
  teamId: z.string().trim().optional(),
});

export const skillResponseSchema = z.looseObject({
  id: z.number().int(),
  projectId: z.number().int().nullable(),
  userId: z.number().int().nullable(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  argumentHint: z.string().nullable(),
  body: z.string(),
  sourceUrl: z.string().nullable(),
  enabled: z.boolean(),
  createdById: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const skillsListResponseSchema = z.looseObject({
  skills: z.array(skillResponseSchema),
});

export const apiReadErrorSchema = z.looseObject({ error: z.string() });

export type BoardMemoryQuery = z.input<typeof boardMemoryQuerySchema>;
export type BoardMemoryResponse = z.output<typeof boardMemoryResponseSchema>;
export type SkillsListQuery = z.input<typeof skillsListQuerySchema>;
export type SkillResponse = z.output<typeof skillResponseSchema>;
export type SkillsListResponse = z.output<typeof skillsListResponseSchema>;
export type ApiReadError = z.output<typeof apiReadErrorSchema>;
