import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { isPaidTeam } from "@/lib/freeTier";
import { HTPR_7686_FREE_PLAN_LIMITS_FLAG } from "@/lib/flags/definitions/htpr-7686-free-plan-limits";

export const FREE_PLAN_MAX_BOARDS = 2;
export const FREE_PLAN_MAX_TICKETS = 250;
export const FREE_PLAN_MAX_FILE_BYTES = 10 * 1024 * 1024;

export type PlanLimitScope =
  | { kind: "team"; teamId: string }
  | { kind: "personal"; ownerId: number };

export type PlanLimitContext = {
  actorUserId: number | null;
  agentId?: string | null;
  entryPoint: string;
};

type PlanLimit = "boards" | "tickets" | "file_size";
type ProjectScopeSource = { teamId: string | null; ownerId: number };
type ScopeDb = Pick<Prisma.TransactionClient, "project">;

function limitMessage(limit: PlanLimit, scope: PlanLimitScope): string {
  const subject = scope.kind === "personal" ? "Your personal boards" : "This team's";
  if (limit === "boards") {
    return `${subject} Free plan allows ${FREE_PLAN_MAX_BOARDS} boards. Upgrade to add more, or archive a board you no longer use.`;
  }
  if (limit === "tickets") {
    return `${subject} Free plan allows ${FREE_PLAN_MAX_TICKETS} open tickets. Upgrade to add more, or archive tickets you're done with.`;
  }
  return `Files on the Free plan can be up to ${FREE_PLAN_MAX_FILE_BYTES / (1024 * 1024)} MB. Upgrade to upload bigger files.`;
}

export class PlanLimitReachedError extends Error {
  readonly code = "PLAN_LIMIT_REACHED";
  readonly status = 402;

  constructor(
    readonly limit: PlanLimit,
    readonly max: number,
    readonly scope: PlanLimitScope,
  ) {
    super(limitMessage(limit, scope));
    this.name = "PlanLimitReachedError";
  }
}

export function isPlanLimitReachedError(error: unknown): error is PlanLimitReachedError {
  if (error instanceof PlanLimitReachedError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<PlanLimitReachedError>;
  return candidate.code === "PLAN_LIMIT_REACHED" &&
    (candidate.limit === "boards" || candidate.limit === "tickets" || candidate.limit === "file_size") &&
    typeof candidate.max === "number" && typeof candidate.message === "string";
}

export function planLimitResponse(error: PlanLimitReachedError) {
  return {
    status: 402 as const,
    body: {
      success: false as const,
      error: error.message,
      message: error.message,
      code: "PLAN_LIMIT_REACHED" as const,
      limit: error.limit,
      max: error.max,
    },
  };
}

export async function isPlanLimitsEnabled(actorUserId: number | null): Promise<boolean> {
  return actorUserId != null && isFeatureEnabled(HTPR_7686_FREE_PLAN_LIMITS_FLAG, actorUserId);
}

export function scopeForProject(project: ProjectScopeSource): PlanLimitScope {
  return project.teamId
    ? { kind: "team", teamId: project.teamId }
    : { kind: "personal", ownerId: project.ownerId };
}

export function scopeKey(scope: PlanLimitScope): string {
  return scope.kind === "team" ? `team:${scope.teamId}` : `personal:${scope.ownerId}`;
}

export function scopeWhere(scope: PlanLimitScope) {
  return scope.kind === "team"
    ? { teamId: scope.teamId }
    : { teamId: null, ownerId: scope.ownerId };
}

export async function limitScopeForProject(projectId: number, db: ScopeDb = prisma): Promise<PlanLimitScope> {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { teamId: true, ownerId: true },
  });
  return scopeForProject(project);
}

export async function isFreeScope(scope: PlanLimitScope): Promise<boolean> {
  return scope.kind === "personal" || !await isPaidTeam(scope.teamId);
}

export async function lockPlanLimitScope(tx: Prisma.TransactionClient, scope: PlanLimitScope) {
  const key = `plan-limit:${scopeKey(scope)}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

export function recordPlanLimitRefusal(event: PlanLimitContext & {
  scope: PlanLimitScope;
  resource: PlanLimit;
  delta?: number;
  bytes?: number;
  max: number;
}): void {
  try {
    console.warn("[plan-limit] refused", event);
  } catch {}
}

function refuse(limit: PlanLimit, max: number, scope: PlanLimitScope, ctx: PlanLimitContext, amount: { delta: number } | { bytes: number }): never {
  recordPlanLimitRefusal({ ...ctx, scope, resource: limit, ...amount, max });
  throw new PlanLimitReachedError(limit, max, scope);
}

export async function assertBoardRoom(tx: Prisma.TransactionClient, scope: PlanLimitScope, delta: number, ctx: PlanLimitContext): Promise<void> {
  if (delta <= 0 || !await isPlanLimitsEnabled(ctx.actorUserId) || !await isFreeScope(scope)) return;
  await lockPlanLimitScope(tx, scope);
  const count = await tx.project.count({ where: { ...scopeWhere(scope), status: "Normal" } });
  if (count + delta > FREE_PLAN_MAX_BOARDS) refuse("boards", FREE_PLAN_MAX_BOARDS, scope, ctx, { delta });
}

export async function assertTicketRoom(tx: Prisma.TransactionClient, scope: PlanLimitScope, delta: number, ctx: PlanLimitContext): Promise<void> {
  if (delta <= 0 || !await isPlanLimitsEnabled(ctx.actorUserId) || !await isFreeScope(scope)) return;
  await lockPlanLimitScope(tx, scope);
  const count = await tx.task.count({
    where: { status: "Normal", project: { ...scopeWhere(scope), status: "Normal" } },
  });
  if (count + delta > FREE_PLAN_MAX_TICKETS) refuse("tickets", FREE_PLAN_MAX_TICKETS, scope, ctx, { delta });
}

export async function assertProjectTicketRoom(tx: Prisma.TransactionClient, projectId: number, delta: number, ctx: PlanLimitContext): Promise<void> {
  if (delta <= 0 || !await isPlanLimitsEnabled(ctx.actorUserId)) return;
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { teamId: true, ownerId: true, status: true },
  });
  const scope = scopeForProject(project);
  if (!await isFreeScope(scope)) return;
  await lockPlanLimitScope(tx, scope);
  await tx.$executeRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR SHARE`;
  const currentProject = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { status: true } });
  if (currentProject.status !== "Normal") return;
  await assertTicketRoom(tx, scope, delta, ctx);
}

export async function assertTaskCountTransition(
  tx: Prisma.TransactionClient,
  before: { projectId: number; status: string },
  after: { projectId: number; status: string },
  ctx: PlanLimitContext,
): Promise<void> {
  if (after.status !== "Normal" ||
      (before.status === "Normal" && before.projectId === after.projectId) ||
      !await isPlanLimitsEnabled(ctx.actorUserId)) return;
  const destination = await tx.project.findUniqueOrThrow({
    where: { id: after.projectId },
    select: { teamId: true, ownerId: true, status: true },
  });
  const scope = scopeForProject(destination);
  if (!await isFreeScope(scope)) return;
  await lockPlanLimitScope(tx, scope);
  for (const projectId of [...new Set([before.projectId, after.projectId])].sort((a, b) => a - b)) {
    await tx.$executeRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR SHARE`;
  }
  const currentDestination = await tx.project.findUniqueOrThrow({ where: { id: after.projectId }, select: { status: true } });
  if (currentDestination.status !== "Normal") return;
  if (before.status === "Normal") {
    const source = before.projectId === after.projectId ? { ...destination, status: currentDestination.status } : await tx.project.findUniqueOrThrow({
      where: { id: before.projectId },
      select: { teamId: true, ownerId: true, status: true },
    });
    if (source.status === "Normal" && scopeKey(scopeForProject(source)) === scopeKey(scope)) return;
  }
  await assertTicketRoom(tx, scope, 1, ctx);
}

export async function assertFileSizeForProject(projectId: number, bytes: number, ctx: PlanLimitContext): Promise<void> {
  if (bytes <= FREE_PLAN_MAX_FILE_BYTES || !await isPlanLimitsEnabled(ctx.actorUserId)) return;
  const scope = await limitScopeForProject(projectId);
  if (await isFreeScope(scope)) refuse("file_size", FREE_PLAN_MAX_FILE_BYTES, scope, ctx, { bytes });
}
