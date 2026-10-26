import { tool } from "ai";
import { z } from "zod";
import { assertSkillScopeAccess } from "@/app/api/ai/_lib/skillAccess";
import { parseSkillMarkdown, slugifySkill, MAX_SKILL_BODY_BYTES } from "@/app/api/ai/_lib/skillMarkdown";
import prisma from "@/lib/prisma";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";
import { Prisma } from "@prisma/client";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createCreateSkillTool(context: ToolContext) {
  const { sendStatus, user, confirmationSessionId, bulkPreviewsIssued } = context;
  return {
    hypertask_create_skill: tool({
      description:
        "Draft a personal or project skill from a requested workflow or this chat session. Returns the complete draft for review before saving. If the slug exists, offer to update the existing skill instead. Save only after the user approves the exact draft in a new message.",
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
        confirmed: z.boolean().optional().describe("True only after the user approves this exact skill draft and scope in a new message."),
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

        const draft = { ...scope, ...parsed, enabled: input.enabled };
        const existing = await prisma.aI_Skill.findFirst({
          where: { ...scope, slug: parsed.slug },
        });
        if (existing) {
          return sanitizeForJson({
            success: false,
            existing_skill: { id: existing.id, slug: existing.slug, name: existing.name },
            skill: draft,
            scope: input.scope,
            message: "This slug already exists in this scope. Offer to update that skill using hypertask_update_skill; do not overwrite it without approval.",
          });
        }
        if (await requireCrossMessageConfirmation({
          userId: user.id,
          sessionId: confirmationSessionId,
          operationKey: `create-skill:${JSON.stringify(draft)}`,
          confirmed: input.confirmed,
          previewsIssuedThisRequest: bulkPreviewsIssued,
        }) === "preview") {
          return sanitizeForJson({
            success: false,
            confirmation_required: true,
            skill: draft,
            scope: input.scope,
            message: "Nothing has been saved. Show the full draft: slug, name, description, trigger (argumentHint), body, enabled and personal or board scope. Ask the user to confirm, edit or reject it. End your turn. Only after approval in a new message repeat this exact call with confirmed: true. Edits require a new preview.",
          });
        }

        try {
          const skill = await prisma.aI_Skill.create({
            data: {
              ...draft,
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
    }),
  };
}
