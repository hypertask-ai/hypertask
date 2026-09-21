import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskDecisionRequestTool(context: ChatToolContext) {
  const { DecisionRequestStatus, TOOL_TASK_ID_DESCRIPTION, actingAgentId, createCommentService, escapeHtml, findTaskByIdentifier, prisma, sanitizeForJson, sanitizeRichHtml, sendStatus, tool, user, validateTaskIdentifier, withToolErrors, z } = context;
  return tool({
      description:
        "Create a durable request for a human decision on a task, with 2-10 distinct options.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().trim().min(1).optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        question: z.string().min(1).max(2000),
        options: z.array(z.string().min(1).max(200)).min(2).max(10),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_decision_request");
        const identifierValidation = validateTaskIdentifier({
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          project_id: input.project_id,
          unique_index: input.unique_index,
        });
        if (!identifierValidation.valid) {
          return { success: false, error: identifierValidation.error };
        }

        const question = input.question.trim();
        const options = input.options.map((option: string) => option.trim());
        if (!question) {
          return { success: false, error: "question is required" };
        }
        if (options.some((option: string) => !option)) {
          return {
            success: false,
            error: "each option must be a non-empty string",
          };
        }
        if (new Set(options).size !== options.length) {
          return { success: false, error: "options must not contain duplicates" };
        }

        const task = await findTaskByIdentifier(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          project_id: input.project_id,
          unique_index: input.unique_index,
        });
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const [taskOwner, currentUser] = await Promise.all([
          prisma.task.findUnique({
            where: { id: task.id },
            select: { userId: true },
          }),
          prisma.user.findUnique({
            where: { id: user.id },
            select: {
              id: true,
              email: true,
              displayName: true,
              photoURL: true,
            },
          }),
        ]);
        if (!taskOwner || !currentUser) {
          return { success: false, error: "Task not found or access denied" };
        }

        const decisionRequest = await prisma.decisionRequest.create({
          data: {
            taskId: task.id,
            question,
            options,
            status: DecisionRequestStatus.Pending,
            createdById: user.id,
            agentId: actingAgentId,
          },
        });
        const optionItems = options
          .map((option: string) => `<li>${escapeHtml(option)}</li>`)
          .join("");
        const comment = await createCommentService({
          text: sanitizeRichHtml(
            `<p><strong>Decision needed:</strong> ${escapeHtml(question)}</p>` +
              `<ol>${optionItems}</ol>` +
              "<p>Reply with your choice, or this will be answerable from the UI soon.</p>"
          ),
          creatorId: user.id,
          taskId: task.id,
          ownerId: taskOwner.userId,
          currentUser,
          agentId: actingAgentId,
        });
        const savedDecisionRequest = await prisma.decisionRequest.update({
          where: { id: decisionRequest.id },
          data: { commentId: comment.id },
        });

        return sanitizeForJson({
          success: true,
          decision_request: {
            id: savedDecisionRequest.id,
            taskId: savedDecisionRequest.taskId,
            question: savedDecisionRequest.question,
            options: savedDecisionRequest.options,
            status: savedDecisionRequest.status.toLowerCase(),
            answer: savedDecisionRequest.answer,
            answerNote: savedDecisionRequest.answerNote,
            createdAt: savedDecisionRequest.createdAt,
            answeredAt: savedDecisionRequest.answeredAt,
            commentId: savedDecisionRequest.commentId,
          },
          comment_id: comment.id,
        });
      }),
    });
}
