import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskUpdateSkillTool(context: ChatToolContext) {
  const { MAX_SKILL_BODY_BYTES, getAccessibleSkill, parseSkillMarkdown, prisma, sanitizeForJson, sendStatus, slugifySkill, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Update an accessible personal or project skill by ID using structured fields or complete SKILL.md content.",
      inputSchema: z.object({
        skill_id: z.coerce.number().int().positive(),
        markdown: z.string().optional(),
        raw_markdown: z.string().optional(),
        slug: z.string().optional(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        argument_hint: z.string().nullable().optional(),
        body: z.string().optional(),
        enabled: z.boolean().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_skill");
        const skill = await getAccessibleSkill(user.id, input.skill_id);
        const markdown = input.markdown ?? input.raw_markdown;
        let data: Record<string, string | null>;
        if (markdown) {
          data = parseSkillMarkdown(markdown);
        } else {
          data = {};
          if (input.name !== undefined) {
            const name = input.name.trim();
            if (!name) {
              return { success: false, error: "Skill name is required" };
            }
            data.name = name;
          }
          if (input.slug !== undefined) {
            const slug = slugifySkill(input.slug);
            if (!slug) {
              return { success: false, error: "Skill slug is required" };
            }
            data.slug = slug;
          } else if (!skill.slug) {
            return { success: false, error: "Skill slug is required" };
          }
          if (input.body !== undefined) {
            const skillBody = input.body.trim();
            if (!skillBody) {
              return { success: false, error: "Skill body is required" };
            }
            if (Buffer.byteLength(skillBody, "utf8") > MAX_SKILL_BODY_BYTES) {
              return {
                success: false,
                error: "Skill body exceeds the 64KB limit",
              };
            }
            data.body = skillBody;
          }
          if (input.description !== undefined) {
            data.description = input.description?.trim() || null;
          }
          if (input.argument_hint !== undefined) {
            data.argumentHint = input.argument_hint?.trim() || null;
          }
        }

        try {
          const updated = await prisma.aI_Skill.update({
            where: { id: skill.id },
            data: {
              ...data,
              ...(input.enabled === undefined
                ? {}
                : { enabled: input.enabled }),
            },
          });
          return sanitizeForJson({ success: true, skill: updated });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            return {
              success: false,
              error: "A skill with this slug already exists in this scope",
            };
          }
          throw error;
        }
      }),
    });
}
