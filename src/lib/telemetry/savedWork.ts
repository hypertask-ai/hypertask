import type { Prisma } from "@prisma/client";
import { enqueueAnalyticsIntent, processAnalyticsIntentSoon } from "./analyticsIntents";

export { processAnalyticsIntentSoon };

export type CreationChannel = "web" | "api" | "mcp" | "agent";
export type BoardCreationMethod = "manual" | "api" | "agent" | "auto" | "seeded" | "adopted_demo";
export type ColumnCreationMethod = "user" | "default" | "seeded";
export type SavedWorkActor = { userId: number | null; agentId?: string | null };

export const CREATION_CHANNEL_HEADER = "X-Hypertask-Creation-Channel";
export const CREATION_AGENT_HEADER = "X-Hypertask-Creation-Agent";

export function creationChannelFromHeader(value: string | null | undefined): CreationChannel {
  return value === "api" || value === "mcp" || value === "agent" ? value : "web";
}

type IntentDb = Pick<Prisma.TransactionClient, "analyticsIntent">;

export function enqueueBoardCreated(db: IntentDb, boardId: number, method: BoardCreationMethod, actor: SavedWorkActor, occurredAt = new Date()): Promise<string> {
  return enqueueAnalyticsIntent(db, { kind: "board_created", payload: { boardId, method, actor, occurredAt: occurredAt.toISOString() } });
}

export function enqueueTaskCreated(db: IntentDb, taskId: number, actor: SavedWorkActor, channel: CreationChannel): Promise<string> {
  return enqueueAnalyticsIntent(db, { kind: "task_created", payload: { taskId, actor, channel } });
}

export function enqueueColumnCreated(db: IntentDb, columnId: number, actor: SavedWorkActor, occurredAt = new Date()): Promise<string> {
  return enqueueAnalyticsIntent(db, { kind: "column_created", payload: { columnId, actor, occurredAt: occurredAt.toISOString() } });
}

export function enqueueColumnRenamed(db: IntentDb, columnId: number, actor: SavedWorkActor, occurredAt = new Date()): Promise<string> {
  return enqueueAnalyticsIntent(db, { kind: "column_renamed", payload: { columnId, actor, occurredAt: occurredAt.toISOString() } });
}
