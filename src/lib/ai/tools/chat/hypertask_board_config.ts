import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskBoardConfigTool(context: ChatToolContext) {
  const { assertProjectAccess, getAiModelOptionById, getProjectWhere, parseBoardPlaybook, prisma, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Read or set BOARD-WIDE AI instructions and playbook for an explicit board/project. Use get_playbook, set_playbook, get_instructions, or set_instructions. Setting either affects every user and agent on that board.",
      inputSchema: z
        .object({
          action: z.enum([
            "get_playbook",
            "set_playbook",
            "get_instructions",
            "set_instructions",
          ]),
          project_id: z.coerce.number().int().positive(),
          definition_of_done: z
            .array(z.string().max(500))
            .max(50)
            .optional(),
          working_rules: z.string().max(5000).optional(),
          notes: z.string().max(5000).optional(),
          custom_instruction: z
            .string()
            .optional()
            .describe("Required when action is set_instructions."),
          model_selected: z.string().optional(),
        })
        .strict(),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_board_config");
        await assertProjectAccess(user.id, input.project_id);

        if (input.action === "get_playbook") {
          const project = await prisma.project.findFirst({
            where: {
              id: input.project_id,
              status: "Normal",
              ...getProjectWhere(user.id),
            },
            select: { id: true, playbook: true },
          });
          if (!project) {
            return {
              success: false,
              error: "Project not found or access denied",
            };
          }

          return sanitizeForJson({
            success: true,
            projectId: project.id,
            playbook: project.playbook ?? null,
          });
        }

        if (input.action === "set_playbook") {
          const parsed = parseBoardPlaybook({
            definition_of_done: input.definition_of_done,
            working_rules: input.working_rules,
            notes: input.notes,
          });
          if (!parsed.ok) {
            return {
              success: false,
              error: parsed.error,
              code: "invalid_field",
              field: "playbook",
            };
          }

          const result = await prisma.project.updateMany({
            where: {
              id: input.project_id,
              status: "Normal",
              ...getProjectWhere(user.id),
            },
            data: { playbook: parsed.value as Prisma.InputJsonValue },
          });
          if (result.count === 0) {
            return {
              success: false,
              error: "Project not found or access denied",
            };
          }

          return {
            success: true,
            projectId: input.project_id,
            playbook: parsed.value,
          };
        }

        if (input.action === "get_instructions") {
          const instruction = await prisma.aI_Custom_Instructions.findFirst({
            where: { projectId: input.project_id },
            include: { attachments: true },
          });

          return sanitizeForJson({ success: true, instruction });
        }

        if (input.custom_instruction === undefined) {
          throw new Error("custom_instruction is required for set_instructions");
        }

        let modelOption;
        if (input.model_selected !== undefined) {
          modelOption = getAiModelOptionById(input.model_selected);
          if (!modelOption) {
            return {
              success: false,
              error: `Unknown model_selected "${input.model_selected}"`,
              details: { field: "model_selected", code: "invalid_value" },
            };
          }
        }

        const existing = await prisma.aI_Custom_Instructions.findFirst({
          where: { projectId: input.project_id },
          select: { id: true },
        });
        const modelData = modelOption
          ? {
              model_selected: modelOption.id,
              source_selected: modelOption.source,
            }
          : {};
        const instruction = existing
          ? await prisma.aI_Custom_Instructions.update({
              where: { id: existing.id },
              data: {
                customInstruction: input.custom_instruction,
                ...modelData,
                lastUpdatedAt: new Date(),
              },
              include: { attachments: true },
            })
          : await prisma.aI_Custom_Instructions.create({
              data: {
                projectId: input.project_id,
                customInstruction: input.custom_instruction,
                ...modelData,
              },
              include: { attachments: true },
            });

        return sanitizeForJson({ success: true, instruction });
      }),
    });
}
