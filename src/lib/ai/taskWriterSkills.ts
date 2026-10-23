import { z } from "zod";

export const TASK_WRITER_SKILLS_HEADER = "X-Task-Writer-Skills";
export const MAX_SKILL_INPUT_LENGTH = 12000;
const MAX_HEADER_LENGTH = 4096;

export const taskWriterSkillsSchema = z.array(z.object({
  id: z.number().int().refine((id) => id > 0 || id === -1),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(200),
  updatedAt: z.string().datetime(),
})).min(1).max(16);

export type TaskWriterSkills = z.infer<typeof taskWriterSkillsSchema>;

export function encodeTaskWriterSkills(skills: TaskWriterSkills): string | undefined {
  const parsed = taskWriterSkillsSchema.safeParse(skills);
  if (!parsed.success) return undefined;
  try {
    const encoded = encodeURIComponent(JSON.stringify(parsed.data));
    return encoded.length <= MAX_HEADER_LENGTH ? encoded : undefined;
  } catch {
    return undefined;
  }
}

export function readTaskWriterSkills(header: string | null | undefined): TaskWriterSkills | undefined {
  if (!header || header.length > MAX_HEADER_LENGTH) return undefined;
  try {
    const parsed = taskWriterSkillsSchema.safeParse(JSON.parse(decodeURIComponent(header)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
