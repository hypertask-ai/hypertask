import { Prisma, Status } from "@prisma/client";

import { isInternalCompTeam } from "@/lib/internalCompTeams";
import prisma from "@/lib/prisma";
import { FEATURE_FLAG_OWNER_USER_ID, isFeatureEnabled } from "@/lib/flags";
import { HTPR_7982_CANCELLED_FREE_FLAG } from "@/lib/flags/definitions/htpr-7982-cancelled-free";
import { FREE_BOARD_LIMIT } from "@/lib/freePlanLimits";
import { subscriptionStatusGrantsAccess } from "@/lib/subscriptionAccess";
import { assertBoardRoom, assertTicketRoom, isFreeScope, isPlanLimitsEnabled, lockPlanLimitScope, scopeForProject, type PlanLimitContext } from "@/lib/planLimits";
import { isTeamComped } from "@/lib/teamComp";

const INTERNAL_TEAM_SAVED_PLAN_FLAG = "htpr-7852-internal-team-saved-plan";

export { FREE_BOARD_LIMIT };
export const FREE_BOARD_LIMIT_MESSAGE = `Free plan includes ${FREE_BOARD_LIMIT} boards. Upgrade to create more.`;

export class BoardLimitReachedError extends Error {
  constructor() {
    super(FREE_BOARD_LIMIT_MESSAGE);
    this.name = "BoardLimitReachedError";
  }
}

const TERMINAL_SUBSCRIPTION_STATUSES = new Set<string>([
  "Free",
  "Expired",
  "canceled",
  "incomplete_expired",
]);

export function isOverFreeBoardLimit(
  ownedBoards: number,
  hasPaidPlan: boolean,
): boolean {
  return !hasPaidPlan && ownedBoards >= FREE_BOARD_LIMIT;
}

export async function hasPaidPlan(userId: number): Promise<boolean> {
  const teams = await prisma.team.findMany({
    where: {
      OR: [{ googleAccount: { userId } }, { members: { some: { userId } } }],
    },
    select: {
      id: true,
      compedUntil: true,
      subscriptionPlan: { select: { subscriptionStatus: true } },
    },
  });

  const cancelledFree = await isFeatureEnabled(HTPR_7982_CANCELLED_FREE_FLAG, userId);
  const savedPlanOnly = await isFeatureEnabled(INTERNAL_TEAM_SAVED_PLAN_FLAG, FEATURE_FLAG_OWNER_USER_ID);

  if (!savedPlanOnly && teams.some((team) => isInternalCompTeam(team.id))) return true;

  return teams.some(
    (team) =>
      isTeamComped(team) ||
      team.subscriptionPlan.some(
        (plan) => cancelledFree
          ? subscriptionStatusGrantsAccess(plan.subscriptionStatus)
          : !TERMINAL_SUBSCRIPTION_STATUSES.has(plan.subscriptionStatus),
      ),
  );
}

export async function isBoardLimitReached(userId: number): Promise<boolean> {
  if (await isPlanLimitsEnabled(userId)) return false;
  const [ownedBoards, paid] = await Promise.all([
    prisma.project.count({ where: { ownerId: userId, status: Status.Normal } }),
    hasPaidPlan(userId),
  ]);
  return isOverFreeBoardLimit(ownedBoards, paid);
}

export async function assertBoardQuota(userId: number): Promise<void> {
  if (await isBoardLimitReached(userId)) {
    throw new BoardLimitReachedError();
  }
}

export async function updateProjectStatus(
  projectId: number,
  status: "Normal" | "Archive",
  context: PlanLimitContext,
) {
  if (status !== "Normal" || !(await isPlanLimitsEnabled(context.actorUserId))) {
    return prisma.project.update({
      where: { id: projectId },
      data: { status },
      select: { id: true, name: true, title: true, status: true },
    });
  }

  return prisma.$transaction(async (tx) => {
    const destination = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { teamId: true, ownerId: true },
    });
    const destinationScope = scopeForProject(destination);
    if (await isFreeScope(destinationScope)) await lockPlanLimitScope(tx, destinationScope);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`);
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { teamId: true, ownerId: true, status: true },
    });
    if (project.status !== Status.Normal) {
      const scope = scopeForProject(project);
      await assertBoardRoom(tx, scope, 1, context);
      const normalTickets = await tx.task.count({ where: { projectId, status: Status.Normal } });
      await assertTicketRoom(tx, scope, normalTickets, context);
    }
    return tx.project.update({
      where: { id: projectId },
      data: { status },
      select: { id: true, name: true, title: true, status: true },
    });
  });
}
