/**
 * Skill-related validation schemas
 *
 * Validations for: list_skills, get_skill, create_skill, update_skill,
 * delete_skill, import_skills
 */

import { z } from 'zod';

export const skillScopeSchema = z
  .enum(['user', 'project'])
  .default('user')
  .describe("Skill scope: 'user' for a personal skill or 'project' for a project skill");

const skillIdSchema = z.coerce
  .number()
  .int()
  .positive('skill_id must be a positive integer');

const projectIdSchema = z.coerce
  .number()
  .int()
  .positive('project_id must be a positive integer');

const optionalTextSchema = z.string();
const optionalNonEmptyTextSchema = z.string().min(1, 'Value cannot be empty');

function normalizeText(value: string): string {
  return value.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalizeText(value);
}

function addScopeIssues(
  data: { scope: 'user' | 'project'; project_id?: number },
  ctx: z.RefinementCtx
): void {
  if (data.scope === 'project' && data.project_id === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'project_id is required when scope is project',
      path: ['project_id'],
    });
  }
}

export function getListSkillsBaseSchema() {
  return z
    .object({
      project_id: projectIdSchema.optional().describe('Project ID. Omit to list personal skills.'),
    })
    .strict();
}

export const ListSkillsInputSchema = getListSkillsBaseSchema();
export type ListSkillsInput = z.infer<typeof ListSkillsInputSchema>;

export function validateAndSanitizeListSkillsInput(input: unknown): ListSkillsInput {
  return ListSkillsInputSchema.parse(input);
}

export function getGetSkillBaseSchema() {
  return z
    .object({
      skill_id: skillIdSchema.describe('Skill ID returned by list_skills'),
    })
    .strict();
}

export const GetSkillInputSchema = getGetSkillBaseSchema();
export type GetSkillInput = z.infer<typeof GetSkillInputSchema>;

export function validateAndSanitizeGetSkillInput(input: unknown): GetSkillInput {
  return GetSkillInputSchema.parse(input);
}

export function getCreateSkillBaseSchema() {
  return z
    .object({
      scope: skillScopeSchema,
      project_id: projectIdSchema.optional().describe('Required when scope is project'),
      markdown: optionalNonEmptyTextSchema
        .optional()
        .describe('Complete SKILL.md content. Use instead of name + slug + body.'),
      name: optionalNonEmptyTextSchema.optional().describe('Skill display name'),
      slug: optionalNonEmptyTextSchema
        .optional()
        .describe('Invocation slug used as /slug in AI chat or @hyperai comments'),
      body: optionalNonEmptyTextSchema.optional().describe('Skill instruction body'),
      description: optionalTextSchema.optional().describe('Short skill description'),
      argument_hint: optionalTextSchema.optional().describe('Hint describing accepted arguments'),
      enabled: z.boolean().optional().describe('Whether the skill is enabled'),
    })
    .strict();
}

export function getCreateSkillInputSchema() {
  return getCreateSkillBaseSchema().superRefine((data, ctx) => {
    addScopeIssues(data, ctx);

    const hasMarkdown = data.markdown !== undefined;
    const hasStructuredField =
      data.name !== undefined || data.slug !== undefined || data.body !== undefined;

    if (!hasMarkdown && !hasStructuredField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide markdown or name + slug + body',
        path: ['markdown'],
      });
    }

    if (hasMarkdown && hasStructuredField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use either markdown or name + slug + body, not both',
        path: ['markdown'],
      });
    }

    if (!hasMarkdown) {
      for (const field of ['name', 'slug', 'body'] as const) {
        if (data[field] === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${field} is required when markdown is not provided`,
            path: [field],
          });
        }
      }
    }
  });
}

export const CreateSkillInputSchema = getCreateSkillInputSchema();
export type CreateSkillInput = z.infer<typeof CreateSkillInputSchema>;

export function validateAndSanitizeCreateSkillInput(input: unknown): CreateSkillInput {
  const validated = CreateSkillInputSchema.parse(input);
  return {
    ...validated,
    markdown: normalizeOptionalText(validated.markdown),
    name: normalizeOptionalText(validated.name),
    slug: normalizeOptionalText(validated.slug),
    body: normalizeOptionalText(validated.body),
    description: normalizeOptionalText(validated.description),
    argument_hint: normalizeOptionalText(validated.argument_hint),
  };
}

export function getUpdateSkillBaseSchema() {
  return z
    .object({
      skill_id: skillIdSchema.describe('Skill ID returned by list_skills'),
      name: optionalNonEmptyTextSchema.optional().describe('Updated skill display name'),
      slug: optionalNonEmptyTextSchema
        .optional()
        .describe('Updated invocation slug used as /slug in AI chat or @hyperai comments'),
      body: optionalNonEmptyTextSchema.optional().describe('Updated skill instruction body'),
      description: optionalTextSchema.optional().describe('Updated short description'),
      argument_hint: optionalTextSchema.optional().describe('Updated argument hint'),
      enabled: z.boolean().optional().describe('Whether the skill is enabled'),
      markdown: optionalNonEmptyTextSchema.optional().describe('Complete updated SKILL.md content'),
    })
    .strict();
}

export function getUpdateSkillInputSchema() {
  return getUpdateSkillBaseSchema().refine(
    (data) =>
      data.name !== undefined ||
      data.slug !== undefined ||
      data.body !== undefined ||
      data.description !== undefined ||
      data.argument_hint !== undefined ||
      data.enabled !== undefined ||
      data.markdown !== undefined,
    {
      message: 'At least one skill field must be provided',
      path: ['name', 'slug', 'body', 'description', 'argument_hint', 'enabled', 'markdown'],
    }
  );
}

export const UpdateSkillInputSchema = getUpdateSkillInputSchema();
export type UpdateSkillInput = z.infer<typeof UpdateSkillInputSchema>;

export function validateAndSanitizeUpdateSkillInput(input: unknown): UpdateSkillInput {
  const validated = UpdateSkillInputSchema.parse(input);
  return {
    ...validated,
    name: normalizeOptionalText(validated.name),
    slug: normalizeOptionalText(validated.slug),
    body: normalizeOptionalText(validated.body),
    description: normalizeOptionalText(validated.description),
    argument_hint: normalizeOptionalText(validated.argument_hint),
    markdown: normalizeOptionalText(validated.markdown),
  };
}

export function getDeleteSkillBaseSchema() {
  return z
    .object({
      skill_id: skillIdSchema.describe('Skill ID returned by list_skills'),
    })
    .strict();
}

export const DeleteSkillInputSchema = getDeleteSkillBaseSchema();
export type DeleteSkillInput = z.infer<typeof DeleteSkillInputSchema>;

export function validateAndSanitizeDeleteSkillInput(input: unknown): DeleteSkillInput {
  return DeleteSkillInputSchema.parse(input);
}

export function getImportSkillsBaseSchema() {
  return z
    .object({
      url: z.string().url('url must be a valid GitHub URL').describe('GitHub skill directory URL'),
      scope: skillScopeSchema,
      project_id: projectIdSchema.optional().describe('Required when scope is project'),
      dry_run: z.boolean().optional().describe('Preview imports without saving them'),
      slugs: z
        .array(optionalNonEmptyTextSchema)
        .min(1, 'slugs cannot be empty')
        .optional()
        .describe('Optional skill slugs to import from the GitHub source'),
    })
    .strict();
}

export function getImportSkillsInputSchema() {
  return getImportSkillsBaseSchema().superRefine((data, ctx) => {
    addScopeIssues(data, ctx);
  });
}

export const ImportSkillsInputSchema = getImportSkillsInputSchema();
export type ImportSkillsInput = z.infer<typeof ImportSkillsInputSchema>;

export function validateAndSanitizeImportSkillsInput(input: unknown): ImportSkillsInput {
  const validated = ImportSkillsInputSchema.parse(input);
  return {
    ...validated,
    url: validated.url.trim(),
    slugs: validated.slugs?.map(normalizeText),
  };
}
