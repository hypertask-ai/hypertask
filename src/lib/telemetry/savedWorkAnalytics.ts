import "server-only";
import prisma from "@/lib/prisma";
import { isGuestUser } from "@/lib/demo/guest";
import { FEATURE_FLAG_OWNER_USER_ID, FEATURE_FLAG_QA_USER_ID, HTPR_7271_SAVED_WORK_EVENTS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { captureAnalyticsOccurrence, serverAnalyticsProperties } from "./analyticsOccurrences";
import { recordActivationOccurrence } from "./activationOccurrences";
import type { BoardCreationMethod, CreationChannel, SavedWorkActor } from "./savedWork";

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
    return;
  }
  if (isGuestUser(board.owner)) return;
  await captureAnalyticsOccurrence(
    board.owner.id,
    "board_created",
    `analytics:board_created:${board.id}`,
    buildBoardCreatedProperties(board, method, actor, occurredAt),
    { scope: "business" },
  );
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
