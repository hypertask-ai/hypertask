import { LogType, Status } from "@prisma/client";

import prisma from "@/lib/prisma";
import { teamCompPlan, type TeamCompPlan } from "@/lib/teamComp";

/** The only account allowed to comp teams, matched on id AND email (same identity as team-gateway-keys). */
const TEAM_COMP_ADMIN = { userId: 6, email: "valentin.yeo@gmail.com" } as const;

export function isTeamCompAdmin(user: { id: number; email: string }) {
  return (
    user.id === TEAM_COMP_ADMIN.userId &&
    user.email.trim().toLowerCase() === TEAM_COMP_ADMIN.email
  );
}

export class TeamCompLookupError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
    readonly candidates: Array<{ id: string; title: string | null }> = [],
  ) {
    super(message);
    this.name = "TeamCompLookupError";
  }
}

const teamCompSelect = {
  id: true,
  title: true,
  compedUntil: true,
  compedPlan: true,
} as const;

export type TeamCompTarget = { teamId?: string; email?: string };

/** Finds exactly one team by id, or by an owner/member email. Never guesses between several. */
export async function findTeamForComp(target: TeamCompTarget) {
  if (target.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: target.teamId },
      select: teamCompSelect,
    });
    if (!team) throw new TeamCompLookupError("Team not found", 404);
    return team;
  }

  const email = target.email?.trim().toLowerCase() ?? "";
  const users = await prisma.user.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  if (userIds.length === 0) throw new TeamCompLookupError("User not found", 404);

  const teams = await prisma.team.findMany({
    where: {
      OR: [
        { googleAccount: { userId: { in: userIds } } },
        { members: { some: { userId: { in: userIds } } } },
      ],
    },
    select: teamCompSelect,
    take: 20,
  });
  if (teams.length === 0) throw new TeamCompLookupError("No team for that email", 404);
  if (teams.length > 1) {
    throw new TeamCompLookupError(
      "That email belongs to several teams. Pass teamId.",
      409,
      teams.map(({ id, title }) => ({ id, title })),
    );
  }
  return teams[0];
}

export function describeTeamComp(team: {
  id: string;
  title: string | null;
  compedUntil: Date | null;
  compedPlan: string | null;
}) {
  return {
    teamId: team.id,
    title: team.title,
    compedPlan: team.compedPlan,
    compedUntil: team.compedUntil?.toISOString() ?? null,
    activeCompPlan: teamCompPlan(team),
  };
}

function compLabel(plan: string | null, until: Date | null) {
  if (!until) return "none";
  return `${plan ?? "Pro"} until ${until.toISOString()}`;
}

/**
 * Sets (plan + until) or clears (null) a team's comp. The team update and its
 * audit log row commit together, so no comp change goes unlogged.
 */
export async function setTeamComp(
  team: { id: string; title: string | null; compedUntil: Date | null; compedPlan: string | null },
  comp: { plan: TeamCompPlan; until: Date } | null,
  actorUserId: number,
) {
  const compedPlan = comp?.plan ?? null;
  const compedUntil = comp?.until ?? null;
  const log =
    `Team comp changed for team ${team.id} (${team.title ?? "untitled"}): ` +
    `${compLabel(team.compedPlan, team.compedUntil)} -> ${compLabel(compedPlan, compedUntil)}`;

  const [updated] = await prisma.$transaction([
    prisma.team.update({
      where: { id: team.id },
      data: { compedPlan, compedUntil },
      select: teamCompSelect,
    }),
    prisma.logs.create({
      data: {
        log,
        type: LogType.Team,
        status: Status.Normal,
        LoggedById: actorUserId,
      },
    }),
  ]);
  return updated;
}
