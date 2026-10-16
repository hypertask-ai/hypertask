import "server-only";
import prisma from "@/lib/prisma";
import { isGuestUser } from "@/lib/demo/guest";
import { FEATURE_FLAG_OWNER_USER_ID, FEATURE_FLAG_QA_USER_ID, HTPR_7271_SAVED_WORK_EVENTS_FLAG, HTPR_7273_COLUMN_EVENTS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { captureAnalyticsOccurrence, serverAnalyticsProperties } from "./analyticsOccurrences";
import { recordActivationOccurrence } from "./activationOccurrences";
import type { BoardCreationMethod, ColumnCreationMethod, CreationChannel, SavedWorkActor } from "./savedWork";

export type AccountCategory = "customer" | "internal" | "qa" | "guest";

const LEGACY_BOARD_SOURCES: ReadonlySet<BoardCreationMethod> = new Set(["manual", "seeded", "adopted_demo"]);

export function accountCategory(user: { id: number; uid?: string | null; email: string }): AccountCategory {
  if (isGuestUser(user)) return "guest";
  const email = user.email.trim().toLowerCase();
  const qaEmail = process.env.QA_LOGIN_EMAIL?.trim().toLowerCase();
  if (user.id === FEATURE_FLAG_QA_USER_ID || (qaEmail && email === qaEmail)) return "qa";
  if (user.id === FEATURE_FLAG_OWNER_USER_ID || email.endsWith("@hypertask.ai")) return "internal";
  return "customer";
}

function actorProperties(actor: SavedWorkActor) {
  return {
    actor_id: actor.agentId ? `agent:${actor.agentId}` : actor.userId === null ? null : String(actor.userId),
    creator_type: actor.agentId ? "agent" : "human",
  };
}

async function loadBoard(boardId: number) {
  return prisma.project.findUnique({
    where: { id: boardId },
    select: { id: true, teamId: true, seeded: true, owner: { select: { id: true, uid: true, email: true } } },
  });
}

type Board = NonNullable<Awaited<ReturnType<typeof loadBoard>>>;

export function buildBoardCreatedProperties(board: Board, method: BoardCreationMethod, actor: SavedWorkActor, occurredAt: Date) {
  const isSeeded = board.seeded || method === "seeded" || method === "adopted_demo";
  return {
    ...serverAnalyticsProperties(board.owner.id, board.teamId, board.id, `board_created:${board.id}`, occurredAt),
    is_seeded: isSeeded,
    account_category: accountCategory(board.owner),
    creation_method: method,
    ...actorProperties(actor),
  };
}

export function buildTaskCreatedProperties(
  board: Board,
  task: { id: number; createdAt: Date },
  actor: SavedWorkActor,
  channel: CreationChannel,
) {
  return {
    ...serverAnalyticsProperties(board.owner.id, board.teamId, board.id, `task_created:${task.id}`, task.createdAt),
    task_id: String(task.id),
    is_seeded: board.seeded,
    account_category: accountCategory(board.owner),
    creation_channel: channel,
    ...actorProperties(actor),
  };
}

export async function captureBoardCreated(
  boardId: number,
  method: BoardCreationMethod,
  actor: SavedWorkActor,
  occurredAt: Date,
): Promise<void> {
  const board = await loadBoard(boardId);
  if (!board) return;
  if (!(await isFeatureEnabled(HTPR_7271_SAVED_WORK_EVENTS_FLAG, actor.userId ?? board.owner.id))) {
    if (LEGACY_BOARD_SOURCES.has(method)) {
      recordActivationOccurrence(board.owner.id, "board_created", String(board.id), { source: method });
    }
  } else if (!isGuestUser(board.owner)) {
    await captureAnalyticsOccurrence(
      board.owner.id,
      "board_created",
      `analytics:board_created:${board.id}`,
      buildBoardCreatedProperties(board, method, actor, occurredAt),
      { scope: "business" },
    );
  }
  await captureBoardColumns(board, method, actor, occurredAt);
}

async function captureBoardColumns(board: Board, method: BoardCreationMethod, actor: SavedWorkActor, occurredAt: Date): Promise<void> {
  if (isGuestUser(board.owner) || !(await isFeatureEnabled(HTPR_7273_COLUMN_EVENTS_FLAG, actor.userId ?? board.owner.id))) return;
  const columns = await prisma.section.findMany({ where: { projectId: board.id, deleted: false }, select: { id: true }, orderBy: { ranking: "asc" } });
  const columnMethod: ColumnCreationMethod = board.seeded || method === "seeded" || method === "adopted_demo" ? "seeded" : "default";
  for (const column of columns) {
    await captureColumnOccurrence(board, column.id, "column_created", `analytics:column_created:${column.id}`, actor, occurredAt, { creation_method: columnMethod });
  }
}

export function buildColumnProperties(
  board: Board,
  columnId: number,
  eventId: string,
  actor: SavedWorkActor,
  occurredAt: Date,
  extra: { creation_method?: ColumnCreationMethod },
) {
  return {
    ...serverAnalyticsProperties(board.owner.id, board.teamId, board.id, eventId, occurredAt),
    column_id: String(columnId),
    is_seeded: board.seeded || extra.creation_method === "seeded",
    account_category: accountCategory(board.owner),
    ...extra,
    ...actorProperties(actor),
  };
}

async function captureColumnOccurrence(
  board: Board,
  columnId: number,
  event: "column_created" | "column_renamed",
  marker: string,
  actor: SavedWorkActor,
  occurredAt: Date,
  extra: { creation_method?: ColumnCreationMethod },
): Promise<void> {
  const eventId = marker.replace(/^analytics:/, "");
  await captureAnalyticsOccurrence(board.owner.id, event, marker, buildColumnProperties(board, columnId, eventId, actor, occurredAt, extra), { scope: "business" });
}

async function loadColumnBoard(columnId: number, actor: SavedWorkActor) {
  const column = await prisma.section.findUnique({ where: { id: columnId }, select: { id: true, projectId: true } });
  if (!column) return null;
  const board = await loadBoard(column.projectId);
  if (!board || isGuestUser(board.owner)) return null;
  if (!(await isFeatureEnabled(HTPR_7273_COLUMN_EVENTS_FLAG, actor.userId ?? board.owner.id))) return null;
  return board;
}

export async function captureColumnCreated(columnId: number, method: ColumnCreationMethod, actor: SavedWorkActor, occurredAt: Date): Promise<void> {
  const board = await loadColumnBoard(columnId, actor);
  if (!board) return;
  await captureColumnOccurrence(board, columnId, "column_created", `analytics:column_created:${columnId}`, actor, occurredAt, { creation_method: method });
}

export async function captureColumnRenamed(columnId: number, actor: SavedWorkActor, occurredAt: Date): Promise<void> {
  const board = await loadColumnBoard(columnId, actor);
  if (!board) return;
  await captureColumnOccurrence(board, columnId, "column_renamed", `analytics:column_renamed:${columnId}:${occurredAt.getTime()}`, actor, occurredAt, {});
}

export async function captureTaskCreated(taskId: number, actor: SavedWorkActor, channel: CreationChannel): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, projectId: true, createdAt: true } });
  if (!task) return;
  const board = await loadBoard(task.projectId);
  if (!board || !(await isFeatureEnabled(HTPR_7271_SAVED_WORK_EVENTS_FLAG, actor.userId ?? board.owner.id))) return;
  await captureAnalyticsOccurrence(
    board.owner.id,
    "task_created",
    `analytics:task_created:${task.id}`,
    buildTaskCreatedProperties(board, task, actor, channel),
    { scope: "business" },
  );
}
