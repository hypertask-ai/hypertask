import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

type TeamMemberWithUser = Prisma.Member_TeamGetPayload<{
  include: { user: true };
}>;

export type TeamMembershipStore = {
  create: (args: unknown) => Promise<TeamMemberWithUser>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
  findUnique: (args: unknown) => Promise<TeamMemberWithUser | null>;
};

export type EnsureTeamMembershipResult = {
  created: boolean;
  member: TeamMemberWithUser;
};

function isTeamMembershipConflict(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "P2002" ||
    !("meta" in error) ||
    typeof error.meta !== "object" ||
    error.meta === null ||
    !("target" in error.meta)
  ) {
    return false;
  }
  const target = error.meta.target;
  const fields = Array.isArray(target)
    ? target.map(String)
    : String(target).split(/[^A-Za-z_]+/);
  return fields.includes("userId") && fields.includes("teamId");
}

/**
 * Create exactly one human membership for a user/team pair. The database unique
 * constraint is the arbiter when two join requests pass their preflight together.
 */
export async function ensureTeamMembership(
  input: { googleAccountId: string; teamId: string; userId: number },
  store: TeamMembershipStore = prisma.member_Team as unknown as TeamMembershipStore,
): Promise<EnsureTeamMembershipResult> {
  try {
    const member = await store.create({
      data: input,
      include: { user: true },
    });
    return { created: true, member };
  } catch (error) {
    if (!isTeamMembershipConflict(error)) throw error;
    const promoted = await store.updateMany({
      where: {
        userId: input.userId,
        teamId: input.teamId,
        status: "Invited",
      },
      data: { status: "Accepted", acceptedAt: new Date() },
    });
    const member = await store.findUnique({
      where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
      include: { user: true },
    });
    if (!member) throw error;
    return { created: promoted.count === 1, member };
  }
}
