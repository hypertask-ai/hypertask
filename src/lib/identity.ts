import { z } from "zod";

export const agentIdSchema = z.string().trim().min(1).brand<"AgentId">();
export const userIdSchema = z.number().int().positive().max(2_147_483_647).brand<"UserId">();

export type AgentId = z.infer<typeof agentIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;

export type AssigneeIdentity =
  | { agentId: AgentId; userId?: never }
  | { userId: UserId; agentId: null };
