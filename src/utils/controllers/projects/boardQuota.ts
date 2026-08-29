import { Status } from "@prisma/client";

import { isInternalCompTeam } from "@/lib/internalCompTeams";
import prisma from "@/lib/prisma";
import { isTeamComped } from "@/lib/teamComp";

export const FREE_BOARD_LIMIT = 3;
export const FREE_BOARD_LIMIT_MESSAGE = `Free plan includes ${FREE_BOARD_LIMIT} boards. Upgrade to create more.`;

export class BoardLimitReachedError extends Error {
  constructor() {
    super(FREE_BOARD_LIMIT_MESSAGE);
    this.name = "BoardLimitReachedError";
  }
}

// Statuses that mean "this subscription is done, nothing is being paid for".
// Mirrors TERMINAL_SUBSCRIPTION_STATUSES in controllers/users/resetUserAccount.ts;
// deliberately NOT the shorter set in planGate.ts, which keeps `Free` rows around
// to map their priceId to a plan kind.
const TERMINAL_SUBSCRIPTION_STATUSES = new Set<string>([
  "Free",
  "Expired",
  "canceled",
  "incomplete_expired",
]);

/** HTPR-4894: the whole rule, as one testable line. */
export function isOverFreeBoardLimit(
  ownedBoards: number,
  hasPaidPlan: boolean,
): boolean {
  return !hasPaidPlan && ownedBoards >= FREE_BOARD_LIMIT;
}

/**
 * Teams the user owns OR belongs to. Membership counts: someone invited onto a paid
 * team creates boards billed to that team, so capping them at 3 would break a paid
 * workspace. Comped teams (internal allowlist, or compedUntil in the future) count
 * as paid, otherwise the owner's own account gets locked out at 3 boards.
 */
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

  return teams.some(
    (team) =>
      isInternalCompTeam(team.id) ||
      isTeamComped(team) ||
      team.subscriptionPlan.some(
        (plan) => !TERMINAL_SUBSCRIPTION_STATUSES.has(plan.subscriptionStatus),
      ),
  );
}

export async function isBoardLimitReached(userId: number): Promise<boolean> {
  const [ownedBoards, paid] = await Promise.all([
    prisma.project.count({ where: { ownerId: userId, status: Status.Normal } }),
    hasPaidPlan(userId),
  ]);
  return isOverFreeBoardLimit(ownedBoards, paid);
}

/** Throwing variant for shared creators whose callers already map errors to responses. */
export async function assertBoardQuota(userId: number): Promise<void> {
  if (await isBoardLimitReached(userId)) {
    throw new BoardLimitReachedError();
  }
}
