import { z } from "zod";

export const createBoardAccessRequestSchema = z.object({
  project_id: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
}).strict();
export const getBoardAccessRequestSchema = z.object({ request_id: z.uuid() }).strict();
export const decideBoardAccessRequestSchema = z.object({ decision: z.enum(["approve", "decline"]) }).strict();

export type BoardAccessReceipt = {
  id: string;
  status: "pending" | "approved" | "declined" | "expired" | "cancelled";
  expiresAt: string;
  resolutionReason: string | null;
  canApprove: boolean;
  accessPresent: boolean;
  nextStep: string;
};
export type BoardAccessSummary = BoardAccessReceipt & {
  agentId: string;
  agentName: string;
  agentPhotoURL: string | null;
  projectId: number;
  boardName: string;
  sameTeam: boolean;
  reason: string;
};
