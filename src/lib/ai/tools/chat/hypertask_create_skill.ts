import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskCreateSkillTool(context: ChatToolContext) {
  const { MAX_SKILL_BODY_BYTES, assertSkillScopeAccess, parseSkillMarkdown, prisma, sanitizeForJson, sendStatus, slugifySkill, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Create a personal or project skill from complete SKILL.md content or structured fields.",
      inputSchema: z.object({
        scope: z.enum(["user", "project"]).default("user"),
        project_id: z.coerce.number().int().positive().optional(),
        markdown: z.string().optional(),
        raw_markdown: z.string().optional(),
        slug: z.string().optional(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        argument_hint: z.string().nullable().optional(),
        body: z.string().optional(),
        enabled: z.boolean().default(true),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_create_skill");
        const scope = await assertSkillScopeAccess(
          user.id,
          input.scope,
          input.project_id
        );
        const markdown = input.markdown ?? input.raw_markdown;
        let parsed;
        if (markdown) {
          parsed = parseSkillMarkdown(markdown);
        } else {
          const name = input.name?.trim() || "";
          const slug = slugifySkill(input.slug || name);
          const skillBody = input.body?.trim() || "";
          if (!name) {
            return { success: false, error: "Skill name is required" };
          }
          if (!slug) {
            return { success: false, error: "Skill slug is required" };
          }
          if (!skillBody) {
            return { success: false, error: "Skill body is required" };
          }
          if (Buffer.byteLength(skillBody, "utf8") > MAX_SKILL_BODY_BYTES) {
            return {
              success: false,
              error: "Skill body exceeds the 64KB limit",
            };
          }
          parsed = {
            name,
            slug,
            body: skillBody,
            description: input.description?.trim() || null,
            argumentHint: input.argument_hint?.trim() || null,
          };
        }

        try {
          const skill = await prisma.aI_Skill.create({
            data: {
              ...scope,
              ...parsed,
              enabled: input.enabled,
              createdById: user.id,
            },
          });
          return sanitizeForJson({ success: true, skill });
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
