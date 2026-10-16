import { waitUntil } from "@vercel/functions";

export type CreationChannel = "web" | "api" | "mcp" | "agent";
export type BoardCreationMethod = "manual" | "api" | "agent" | "auto" | "seeded" | "adopted_demo";
export type SavedWorkActor = { userId: number | null; agentId?: string | null };

export const CREATION_CHANNEL_HEADER = "X-Hypertask-Creation-Channel";
export const CREATION_AGENT_HEADER = "X-Hypertask-Creation-Agent";

export function creationChannelFromHeader(value: string | null | undefined): CreationChannel {
  return value === "api" || value === "mcp" || value === "agent" ? value : "web";
}

function afterResponse(work: () => Promise<unknown>): void {
  const promise = work().catch(() => undefined);
  try {
    waitUntil(promise);
  } catch {
    void promise;
  }
}

export function recordBoardCreated(boardId: number, method: BoardCreationMethod, actor: SavedWorkActor, occurredAt = new Date()): void {
  afterResponse(async () => (await import("./savedWorkAnalytics")).captureBoardCreated(boardId, method, actor, occurredAt));
}

export function recordTaskCreated(taskId: number, actor: SavedWorkActor, channel: CreationChannel): void {
  afterResponse(async () => (await import("./savedWorkAnalytics")).captureTaskCreated(taskId, actor, channel));
}
