import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskImportSkillsTool(context: ChatToolContext) {
  const { assertSkillScopeAccess, importSkillsFromGitHub, prisma, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Import personal or project skills from a GitHub URL, with optional dry-run and slug selection.",
      inputSchema: z.object({
        url: z.string().url(),
        scope: z.enum(["user", "project"]),
        project_id: z.coerce.number().int().positive().optional(),
        dry_run: z.boolean().default(false),
        slugs: z.array(z.string()).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_import_skills");
        const scope = await assertSkillScopeAccess(
          user.id,
          input.scope,
          input.project_id
        );
        const parsed = await importSkillsFromGitHub(input.url, user.id);
        const selected = input.slugs
          ? parsed.filter((skill) => input.slugs?.includes(skill.slug))
          : parsed;
        if (input.dry_run) {
          return sanitizeForJson({ success: true, skills: parsed });
        }
        if (selected.length === 0) {
          return {
            success: false,
            error: "Select at least one skill to import",
          };
        }

        const skills = await prisma.$transaction(
          selected.map((skill) => {
            const data = {
              name: skill.name,
              description: skill.description,
              argumentHint: skill.argumentHint,
              body: skill.body,
              sourceUrl: skill.sourceUrl,
              enabled: true,
              createdById: user.id,
            };
            return input.scope === "project"
              ? prisma.aI_Skill.upsert({
                  where: {
                    projectId_slug: {
                      projectId: scope.projectId as number,
                      slug: skill.slug,
                    },
                  },
                  create: { ...scope, ...data, slug: skill.slug },
                  update: data,
                })
              : prisma.aI_Skill.upsert({
                  where: {
                    userId_slug: { userId: user.id, slug: skill.slug },
                  },
                  create: { ...scope, ...data, slug: skill.slug },
                  update: data,
                });
          })
        );
        return sanitizeForJson({
          success: true,
          skills,
          total: skills.length,
        });
      }),
    });
}
