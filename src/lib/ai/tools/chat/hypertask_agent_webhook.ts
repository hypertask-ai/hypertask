import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import type { AgentWebhookManagementAction } from "@/lib/agentWebhooks/management";

export function createHypertaskAgentWebhookTool(context: ChatToolContext) {
  const { actingAgentId, manageAgentWebhook, requireAccountManagementConfirmation, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Get or manage one agent's signed outbound webhook. Actions: get, configure, test, replay, rotate, delete. A native agent may use agent_id=self; otherwise use an owned agent UUID. Configure and rotate return the signing secret once. Every mutation requires confirmation in a later user message.",
      inputSchema: z
        .object({
          action: z
            .enum(["get", "configure", "test", "replay", "rotate", "delete"])
            .default("get"),
          agent_id: z.string().trim().min(1).default("self"),
          url: z.string().trim().url().max(2000).optional(),
          project_id: z.number().int().positive().nullable().optional(),
          events: z
            .array(
              z.enum([
                "comment.mention",
                "task.assigned",
                "task.unassigned",
                "comment.created",
                "task.updated",
                "task.created",
              ]),
            )
            .min(1)
            .optional(),
          active: z.boolean().optional(),
          delivery_id: z.string().uuid().optional(),
          confirmed: z.boolean().optional(),
        })
        .strict(),
      execute: withToolErrors(async ({ confirmed, ...input }) => {
        sendStatus("hypertask_agent_webhook");
        const agentId =
          input.agent_id === "self" ? actingAgentId : input.agent_id;
        if (!agentId) {
          return {
            success: false,
            error: "Use an owned agent UUID; self is only available in a native agent chat.",
          };
        }
        if (actingAgentId && agentId !== actingAgentId) {
          return {
            success: false,
            error: "A native agent can only manage its own webhook.",
          };
        }
        if (input.action !== "get") {
          const preview = await requireAccountManagementConfirmation(
            `agent-webhook:${input.action}`,
            { ...input, agent_id: agentId },
            confirmed,
            `This would ${input.action} the outbound webhook for agent ${agentId}.`,
          );
          if (preview) return preview;
        }
        return sanitizeForJson(
          await manageAgentWebhook({
            userId: user.id,
            agentId,
            action: input.action as AgentWebhookManagementAction,
            url: input.url,
            projectId: input.project_id,
            events: input.events,
            active: input.active,
            deliveryId: input.delivery_id,
          }),
        );
      }),
    });
}
