import { tool } from "ai";
import { z } from "zod";
import { getAccessibleSkill } from "@/app/api/ai/_lib/skillAccess";
import { parseSkillMarkdown, slugifySkill, MAX_SKILL_BODY_BYTES } from "@/app/api/ai/_lib/skillMarkdown";
import prisma from "@/lib/prisma";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";
import { Prisma } from "@prisma/client";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createUpdateSkillTool(context: ToolContext) {
  const { sendStatus, user, confirmationSessionId, bulkPreviewsIssued } = context;
  return {
    hypertask_update_skill: tool({
      description:
        "Draft an update to an accessible personal or project skill by ID using structured fields or complete SKILL.md content. Show the complete revised skill and save only after the user approves that exact draft in a new message.",
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
        confirmed: z.boolean().optional().describe("True only after the user approves this exact revised skill in a new message."),
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

        const changes = {
          ...data,
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        };
        if (await requireCrossMessageConfirmation({
          userId: user.id,
          sessionId: confirmationSessionId,
          operationKey: `update-skill:${skill.id}:${JSON.stringify({ skill, changes })}`,
          confirmed: input.confirmed,
          previewsIssuedThisRequest: bulkPreviewsIssued,
        }) === "preview") {
          return sanitizeForJson({
            success: false,
            confirmation_required: true,
            skill: { ...skill, ...changes },
            scope: skill.projectId === null ? "user" : "project",
            message: "Nothing has been saved. Show the full revised draft and its personal or board scope. Ask the user to confirm, edit or reject it. End your turn. Only after approval in a new message repeat this exact call with confirmed: true. Edits require a new preview.",
          });
        }

        try {
          const updated = await prisma.aI_Skill.update({
            where: { id: skill.id, updatedAt: skill.updatedAt },
            data: changes,
          });
          return sanitizeForJson({ success: true, skill: updated });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
            return { success: false, error: "This skill changed during review. Request a fresh draft before saving." };
          }
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
