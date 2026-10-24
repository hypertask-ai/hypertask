import { randomUUID } from "node:crypto";
import type { AgentBoardAccessRequest, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7582_AGENT_ACCESS_REQUEST_FLAG } from "@/lib/flags/definitions/htpr-7582-agent-access-request";
import type { McpAuthContext } from "@/lib/mcp/auth/types";
import type { SessionUser } from "@/lib/auth/getSessionUser";
import { getManagementKeyTeam } from "@/lib/mcp/managementKeyTeamScope";
import { addAgentToBoard, getAccessibleAgentBoard } from "@/utils/controllers/agents/boardMembers";
import { canAttachAgentToTeam } from "@/utils/controllers/agents/teamScope";
import { broadcastInboxChange } from "@/lib/realtime/server";
import type { BoardAccessReceipt } from "./contracts";

type Database = Prisma.TransactionClient;
type Actor = { userId: number; agentId?: string | null; credential: "agent_bearer" | "human_cookie" | "agent_cookie" | "cli_bearer" };
const DAY = 86_400_000;
export class BoardAccessError extends Error {
  constructor(public status: number, public code: string, public retryAfter?: number) {
    super(code === "unavailable" ? "Board access request unavailable" : code.replaceAll("_", " "));
  }
}

export async function boardAccessFeatureEnabled(userId: number, db: Database = prisma) {
  return isFeatureEnabled(HTPR_7582_AGENT_ACCESS_REQUEST_FLAG, userId, db).catch(() => false);
}

export async function boardAccessAudit(db: Database, actor: Actor, operation: string, outcome: string, reason: string, row?: Pick<AgentBoardAccessRequest, "id" | "agentIdAtRequest" | "ownerUserIdAtRequest" | "projectIdAtRequest">, projectId?: number) {
  await db.logs.create({ data: {
    type: "Board", status: "Normal", LoggedById: actor.userId,
    log: JSON.stringify({ event: "agent_board_access_request", operation, outcome, reason,
      requestId: row?.id ?? null, agentId: row?.agentIdAtRequest ?? actor.agentId ?? null,
      ownerId: row?.ownerUserIdAtRequest ?? actor.userId, projectId: row?.projectIdAtRequest ?? projectId ?? null,
      actorUserId: actor.userId, credential: actor.credential }),
  } });
}

export async function boardAccessTransaction<T>(run: (db: Database) => Promise<T>) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(run, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt >= 3 || !(typeof error === "object" && error !== null && "code" in error && ["P2034", "P2002"].includes(String(error.code)))) throw error;
    }
  }
}

async function attempt<T>(actor: Actor, operation: string, run: (db: Database) => Promise<T>, requestId?: string, projectId?: number) {
  try {
    return await boardAccessTransaction(run);
  } catch (error) {
    await boardAccessAudit(prisma, actor, operation, "denied", error instanceof BoardAccessError ? error.code : "transaction_failed",
      requestId ? { id: requestId, agentIdAtRequest: actor.agentId ?? "", ownerUserIdAtRequest: actor.userId, projectIdAtRequest: projectId ?? 0 } : undefined, projectId);
    throw error;
  }
}

async function ownerLock(db: Database, ownerId: number) {
  await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId} FOR UPDATE`;
}

async function requireFlag(db: Database, userId: number) {
  if (!await boardAccessFeatureEnabled(userId, db)) throw new BoardAccessError(403, "feature_disabled");
}

async function liveAgent(db: Database, ctx: McpAuthContext, write: boolean) {
  if (!ctx.agentId || ctx.management) throw new BoardAccessError(403, "agent_bearer_required");
  const agent = await db.agent.findUnique({ where: { id: ctx.agentId }, include: { members: { select: { project: { select: { teamId: true } } } } } });
  if (!agent || agent.userId !== ctx.user.id || agent.revokedAt ||
      ctx.agentTokenGeneration !== agent.mcpTokenJti || ctx.agentRuntimeGeneration !== agent.runtimeGeneration ||
      (ctx.teamScope?.teamId ?? null) !== agent.credentialTeamId || (ctx.teamScope?.accessBinding ?? null) !== agent.credentialTeamAccessBinding) {
    throw new BoardAccessError(401, "invalid_agent_credential");
  }
  const role = (agent.permissions as { role?: string } | null)?.role ?? "write";
  if (write && !["write", "admin"].includes(role)) throw new BoardAccessError(403, "write_role_required");
  if (ctx.teamScope) {
    const team = await getManagementKeyTeam(ctx.user.id, ctx.teamScope.teamId, db);
    if (team?.accessBinding !== ctx.teamScope.accessBinding) throw new BoardAccessError(401, "invalid_agent_credential");
  }
  return agent;
}

async function currentState(db: Database, row: AgentBoardAccessRequest) {
  const agent = row.agentId ? await db.agent.findUnique({ where: { id: row.agentId }, include: { members: { select: { project: { select: { teamId: true } } } } } }) : null;
  if (!agent || agent.userId !== row.ownerUserIdAtRequest || agent.revokedAt || agent.runtimeGeneration !== row.runtimeGeneration ||
      agent.mcpTokenJti !== row.tokenGeneration || agent.credentialTeamId !== row.credentialTeamId || agent.credentialTeamAccessBinding !== row.credentialTeamAccessBinding) {
    return { invalid: "agent_changed" as const };
  }
  const scope = row.credentialTeamId && row.credentialTeamAccessBinding ? { teamId: row.credentialTeamId, accessBinding: row.credentialTeamAccessBinding } : null;
  if (scope && (await getManagementKeyTeam(row.ownerUserIdAtRequest, scope.teamId, db))?.accessBinding !== scope.accessBinding) return { invalid: "credential_changed" as const };
  const board = row.projectId ? await getAccessibleAgentBoard(row.projectId, row.ownerUserIdAtRequest, null, scope, db) : null;
  if (!board?.teamId || board.teamId !== row.targetTeamIdAtRequest || (scope && scope.teamId !== board.teamId)) return { invalid: "board_unavailable" as const };
  const disabled = row.status === "pending" && await db.logs.findFirst({ where: { log: "agent_board_access_requests_disabled", createdAt: { gte: row.createdAt } }, select: { id: true } });
  if (disabled) return { invalid: "feature_disabled" as const };
  const member = await db.member.findFirst({ where: { projectId: board.id, agentId: agent.id }, select: { id: true } });
  return { agent, board, member, canApprove: canAttachAgentToTeam(agent.members.map(({ project }) => project.teamId), board.teamId) };
}

async function resolve(db: Database, row: AgentBoardAccessRequest, actor: Actor, status: "approved" | "declined" | "expired" | "cancelled", reason: string, now: Date, memberId?: number) {
  const updated = await db.agentBoardAccessRequest.update({ where: { id: row.id }, data: { status, resolutionReason: reason, resolvedAt: now,
    ...(actor.credential === "human_cookie" ? { decidedByUserId: actor.userId } : {}), ...(memberId ? { memberId } : {}) } });
  await boardAccessAudit(db, actor, status, "terminal", reason, updated);
  return updated;
}

async function refresh(db: Database, row: AgentBoardAccessRequest, actor: Actor, now: Date) {
  const state = await currentState(db, row);
  if (row.status === "pending") {
    if (row.expiresAt <= now) row = await resolve(db, row, actor, "expired", "expired", row.expiresAt);
    else if (state.invalid) row = await resolve(db, row, actor, "cancelled", state.invalid, now);
  }
  return { row, state };
}

function receipt(row: AgentBoardAccessRequest, state: Awaited<ReturnType<typeof currentState>>): BoardAccessReceipt {
  const accessPresent = Boolean(state.member);
  const canApprove = row.status === "pending" && !state.invalid && Boolean(state.canApprove);
  const nextStep = row.status === "approved"
    ? accessPresent ? "Approved. Board access is available." : "This request was approved, but access is no longer present."
    : row.status === "pending"
      ? canApprove ? "Waiting for your human owner to approve in Inbox → Decisions." : state.invalid ? "Board access request unavailable." : "Agent belongs to another team. This request cannot be approved."
      : row.status === "declined" ? "Declined. No board access was added." : "This request is no longer actionable.";
  return { id: row.id, status: row.status, expiresAt: row.expiresAt.toISOString(), resolutionReason: row.resolutionReason, canApprove, accessPresent, nextStep };
}

export async function createBoardAccessRequest(ctx: McpAuthContext, input: { project_id: number; reason: string }, at?: Date) {
  const actor: Actor = { userId: ctx.user.id, agentId: ctx.agentId, credential: "agent_bearer" };
  const result = await attempt(actor, "create", async (db) => {
    await ownerLock(db, ctx.user.id);
    const now = at ?? new Date();
    await requireFlag(db, ctx.user.id);
    const agent = await liveAgent(db, ctx, true);
    const board = await getAccessibleAgentBoard(input.project_id, ctx.user.id, null, ctx.teamScope, db);
    if (!board?.teamId || (ctx.teamScope && ctx.teamScope.teamId !== board.teamId)) throw new BoardAccessError(404, "unavailable");
    const member = await db.member.findFirst({ where: { projectId: board.id, agentId: agent.id }, select: { id: true } });
    if (member) {
      await boardAccessAudit(db, actor, "create", "allowed", "already_member", undefined, board.id);
      return { created: false, already_member: true };
    }
    const pending = await db.agentBoardAccessRequest.findFirst({ where: { agentId: agent.id, projectId: board.id, status: "pending" } });
    if (pending) {
      const current = await refresh(db, pending, actor, now);
      if (current.row.status === "pending") {
        await boardAccessAudit(db, actor, "create", "replay", "pending", pending);
        return { created: false, request: receipt(current.row, current.state) };
      }
      if (current.row.resolvedAt && current.row.resolvedAt.getTime() + DAY > now.getTime()) {
        return { created: false, cooldown: true, retryAfter: Math.max(1, Math.ceil((current.row.resolvedAt.getTime() + DAY - now.getTime()) / 1000)), request: receipt(current.row, current.state) };
      }
    }
    const cooldown = await db.agentBoardAccessRequest.findFirst({ where: { agentIdAtRequest: agent.id, projectIdAtRequest: board.id, status: { in: ["declined", "expired", "cancelled"] }, resolvedAt: { gt: new Date(now.getTime() - DAY) } } });
    if (cooldown) throw new BoardAccessError(429, "request_cooldown", Math.max(1, Math.ceil((cooldown.resolvedAt!.getTime() + DAY - now.getTime()) / 1000)));
    const [hour, day, active] = await Promise.all([
      db.agentBoardAccessRequest.count({ where: { agentIdAtRequest: agent.id, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } }),
      db.agentBoardAccessRequest.count({ where: { ownerUserIdAtRequest: ctx.user.id, createdAt: { gt: new Date(now.getTime() - DAY) } } }),
      db.agentBoardAccessRequest.count({ where: { ownerUserIdAtRequest: ctx.user.id, status: "pending", expiresAt: { gt: now } } }),
    ]);
    if (hour >= 5 || day >= 20 || active >= 20) throw new BoardAccessError(429, "request_limit", 3600);
    const row = await db.agentBoardAccessRequest.create({ data: {
      id: randomUUID(), agentId: agent.id, projectId: board.id, agentIdAtRequest: agent.id, projectIdAtRequest: board.id,
      ownerUserIdAtRequest: ctx.user.id, targetTeamIdAtRequest: board.teamId, credentialTeamId: agent.credentialTeamId,
      credentialTeamAccessBinding: agent.credentialTeamAccessBinding, tokenGeneration: agent.mcpTokenJti,
      runtimeGeneration: agent.runtimeGeneration, reason: input.reason, createdAt: now, expiresAt: new Date(now.getTime() + 7 * DAY),
    } });
    await db.notification.create({ data: { type: "AgentBoardAccessRequest", userId: ctx.user.id, agentId: null, fromAgentId: agent.id,
      taskId: null, projectId: board.id, boardAccessRequestId: row.id } });
    await boardAccessAudit(db, actor, "create", "allowed", "created", row);
    return { created: true, request: receipt(row, await currentState(db, row)) };
  }, undefined, input.project_id);
  if ("cooldown" in result && result.cooldown) {
    await boardAccessAudit(prisma, actor, "create", "denied", "request_cooldown", undefined, input.project_id);
    throw new BoardAccessError(429, "request_cooldown", result.retryAfter);
  }
  if (result.created) await broadcastInboxChange(ctx.user.id, { originUserId: ctx.user.id }).catch(() => {});
  return result;
}

export async function getBoardAccessRequest(ctx: McpAuthContext, id: string, at?: Date) {
  const actor: Actor = { userId: ctx.user.id, agentId: ctx.agentId, credential: "agent_bearer" };
  return attempt(actor, "status", async (db) => {
    await ownerLock(db, ctx.user.id);
    const now = at ?? new Date();
    await requireFlag(db, ctx.user.id);
    const agent = await liveAgent(db, ctx, false);
    const row = await db.agentBoardAccessRequest.findUnique({ where: { id } });
    if (!row || row.agentId !== agent.id || row.ownerUserIdAtRequest !== ctx.user.id || row.runtimeGeneration !== agent.runtimeGeneration || row.tokenGeneration !== agent.mcpTokenJti || row.credentialTeamId !== agent.credentialTeamId || row.credentialTeamAccessBinding !== agent.credentialTeamAccessBinding) throw new BoardAccessError(404, "unavailable");
    const current = await refresh(db, row, actor, now);
    if (current.row.resolvedAt && current.row.resolvedAt.getTime() + 30 * DAY <= now.getTime()) throw new BoardAccessError(404, "unavailable");
    await boardAccessAudit(db, actor, "status", "allowed", current.row.status, row);
    return { request: receipt(current.row, current.state) };
  }, id);
}

export async function decideBoardAccessRequest(session: SessionUser, id: string, decision: "approve" | "decline", at?: Date) {
  const actor: Actor = { userId: session.userId, agentId: session.agentId, credential: "human_cookie" };
  const result = await attempt(actor, decision, async (db) => {
    if (session.agentId || session.source === "cli-bearer") throw new BoardAccessError(403, "human_owner_required");
    await ownerLock(db, session.userId);
    const now = at ?? new Date();
    await requireFlag(db, session.userId);
    const row = await db.agentBoardAccessRequest.findUnique({ where: { id } });
    if (!row || row.ownerUserIdAtRequest !== session.userId) throw new BoardAccessError(404, "unavailable");
    if (row.resolvedAt && row.resolvedAt.getTime() + 30 * DAY <= now.getTime()) throw new BoardAccessError(404, "unavailable");
    const current = await refresh(db, row, actor, now);
    if (current.state.invalid) {
      await boardAccessAudit(db, actor, decision, "denied", current.state.invalid, row);
      return { request: receipt(current.row, current.state) };
    }
    if (current.row.status !== "pending") {
      await boardAccessAudit(db, actor, decision, "replay", current.row.status, row);
      return { request: receipt(current.row, current.state) };
    }
    const decidedAt = at ?? new Date();
    if (row.expiresAt <= decidedAt) {
      const expired = await resolve(db, row, actor, "expired", "expired", row.expiresAt);
      return { request: receipt(expired, current.state) };
    }
    if (decision === "decline") {
      const declined = await resolve(db, row, actor, "declined", "owner_declined", decidedAt);
      await boardAccessAudit(db, actor, "decline", "allowed", "owner_declined", declined);
      return { request: receipt(declined, current.state) };
    }
    if (!current.state.canApprove) throw new BoardAccessError(403, "other_team");
    let memberId = current.state.member?.id;
    if (!memberId) {
      const grant = await addAgentToBoard(row.projectId!, row.agentId!, session.userId, undefined, db);
      if (!grant.ok) throw new BoardAccessError(grant.status, "grant_refused");
      memberId = grant.member.id;
    }
    const approved = await resolve(db, row, actor, "approved", current.state.member ? "already_member" : "owner_approved", decidedAt, memberId);
    await boardAccessAudit(db, actor, "approve", "allowed", approved.resolutionReason!, approved);
    return { request: receipt(approved, { ...current.state, member: { id: memberId } }) };
  }, id);
  await broadcastInboxChange(session.userId, { originUserId: session.userId }).catch(() => {});
  return result;
}

export async function getOwnerBoardAccessNotifications(principal: Pick<SessionUser, "userId" | "agentId" | "source"> | undefined, status: "Normal" | "Archive" = "Normal", at?: Date) {
  if (!principal || principal.agentId || principal.source === "cli-bearer" || !await boardAccessFeatureEnabled(principal.userId)) return [];
  return boardAccessTransaction(async (db) => {
    await ownerLock(db, principal.userId);
    const now = at ?? new Date();
    if (!await boardAccessFeatureEnabled(principal.userId, db)) return [];
    const rows = await db.notification.findMany({ where: { userId: principal.userId, agentId: null, type: "AgentBoardAccessRequest", status, ...(status === "Normal" ? { archivedAt: null } : {}),
      boardAccessRequest: { ownerUserIdAtRequest: principal.userId, OR: [{ status: "pending" }, { resolvedAt: { gt: new Date(now.getTime() - 30 * DAY) } }] } },
      include: { boardAccessRequest: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const visible = [];
    const actor: Actor = { userId: principal.userId, credential: "human_cookie" };
    for (const notification of rows) {
      if (!notification.boardAccessRequest) continue;
      const { row, state } = await refresh(db, notification.boardAccessRequest, actor, now);
      if (state.invalid || (row.resolvedAt && row.resolvedAt.getTime() + 30 * DAY <= now.getTime())) continue;
      visible.push({ ...notification, task: null, isDecision: true, boardAccessRequest: { ...receipt(row, state), agentId: state.agent!.id,
        agentName: state.agent!.displayName, agentPhotoURL: state.agent!.photoURL, projectId: state.board!.id,
        boardName: state.board!.title ?? state.board!.name ?? "Board", sameTeam: Boolean(state.canApprove), reason: row.reason } });
    }
    await boardAccessAudit(db, actor, "list", "allowed", "owner_requests");
    return visible;
  });
}

export async function cleanupBoardAccessRequests(now = new Date()) {
  return boardAccessTransaction(async (db) => {
    const rows = await db.agentBoardAccessRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 100 });
    for (const candidate of rows) {
      await ownerLock(db, candidate.ownerUserIdAtRequest);
      const row = await db.agentBoardAccessRequest.findUnique({ where: { id: candidate.id } });
      if (!row || row.status !== "pending") continue;
      const actor: Actor = { userId: row.ownerUserIdAtRequest, credential: "human_cookie" };
      if (!await boardAccessFeatureEnabled(row.ownerUserIdAtRequest, db)) await resolve(db, row, actor, "cancelled", "feature_disabled", now);
      else await refresh(db, row, actor, now);
    }
    const terminal = await db.agentBoardAccessRequest.findMany({ where: { status: { not: "pending" }, resolvedAt: { lte: new Date(now.getTime() - 30 * DAY) } }, select: { id: true }, take: 100 });
    return db.agentBoardAccessRequest.deleteMany({ where: { id: { in: terminal.map(({ id }) => id) } } });
  });
}

export async function mutateBoardAccessNotification(session: SessionUser, id: number, taskId: unknown, change: { seen?: boolean; status?: "Normal" | "Archive" }) {
  const notification = await prisma.notification.findUnique({ where: { id }, select: { type: true } });
  if (notification?.type !== "AgentBoardAccessRequest") return null;
  return boardAccessTransaction(async (db) => {
    if (session.agentId || session.source === "cli-bearer" || taskId != null) throw new BoardAccessError(403, "human_owner_required");
    await ownerLock(db, session.userId);
    await requireFlag(db, session.userId);
    const row = await db.notification.findFirst({ where: { id, userId: session.userId, agentId: null, type: "AgentBoardAccessRequest", status: { not: "Deleted" } }, include: { boardAccessRequest: true } });
    if (!row?.boardAccessRequest || row.boardAccessRequest.ownerUserIdAtRequest !== session.userId) throw new BoardAccessError(404, "unavailable");
    const current = await refresh(db, row.boardAccessRequest, { userId: session.userId, credential: "human_cookie" }, new Date());
    if (current.state.invalid || (current.row.resolvedAt && current.row.resolvedAt.getTime() + 30 * DAY <= Date.now())) throw new BoardAccessError(404, "unavailable");
    return db.notification.update({ where: { id }, data: { ...change, ...(change.status ? { archivedAt: change.status === "Archive" ? new Date() : null } : {}) } });
  });
}

export async function recordBoardAccessDenial(actor: Actor, operation: string, reason: string, requestId?: string, projectId?: number) {
  await boardAccessAudit(prisma, actor, operation, "denied", reason,
    requestId ? { id: requestId, agentIdAtRequest: actor.agentId ?? "", ownerUserIdAtRequest: actor.userId, projectIdAtRequest: projectId ?? 0 } : undefined, projectId);
}
