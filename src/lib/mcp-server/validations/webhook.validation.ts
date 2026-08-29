import { z } from "zod";

const agentWebhookEvents = z.enum([
  "comment.mention",
  "task.assigned",
  "task.unassigned",
  "comment.created",
  "task.updated",
  "task.created",
]);

const agentWebhookInputObjectSchema = z.object({
  action: z
    .enum(["get", "configure", "test", "replay", "rotate", "delete"])
    .default("get"),
  agent_id: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Use self with agent credentials, or an owned agent UUID with human credentials.",
    ),
  url: z.string().trim().url().max(2000).optional(),
  project_id: z.number().int().positive().nullable().optional(),
  events: z.array(agentWebhookEvents).min(1).optional(),
  active: z.boolean().optional(),
  delivery_id: z.string().uuid().optional(),
}).strict();

/** Portable MCP/HyperAI parameters must remain extendable as a Zod object. */
export function getAgentWebhookInputSchema() {
  return agentWebhookInputObjectSchema;
}

export const AgentWebhookInputSchema = getAgentWebhookInputSchema();
export type AgentWebhookInput = z.infer<typeof AgentWebhookInputSchema>;

/** Cross-field validation belongs at execution time, after surface projection. */
export const AgentWebhookExecutionSchema = AgentWebhookInputSchema.superRefine(
  (input, ctx) => {
    if (input.action === "replay" && !input.delivery_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["delivery_id"],
        message: "delivery_id is required for replay",
      });
    }
  },
);
