import { AgentBoardInviteScopeError, assertAgentBoardInviteScope } from "@/lib/mcp/agents/delegatedAccess";
import { processAnalyticsIntentSoon } from "@/lib/telemetry/analyticsIntents";
import { LogType, Status, type Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { enqueueMemberJoined } from "@/lib/telemetry/inviteAnalytics";
import { withTeamSeatBillingLock } from "@/lib/seatBillingLock";
import { mutateAndSyncSeatBilling } from "@/lib/syncSeatBilling";
import { ensureTeamMembership } from "@/lib/teamMembership";
import createLog from "@/utils/controllers/logs/createLog";
import { updateTrial } from "@/utils/controllers/members/updateTrial";

export type AddedProjectMember = {
  id: number | null;
  userId: number;
  displayName: string | null;
  email: string | null;
};

export type AddExistingUserToProjectResult =
  | {
      ok: true;
      outcome: "added" | "already_member";
      member: AddedProjectMember;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

type JoinMutationResult = {
  memberId: number | null;
  outcome: "added" | "already_member";
  error?: string;
};

export async function addExistingUserToProject(
  projectId: number,
  userId: number,
  inviterUserId: number | null = null,
  actingAgentId?: string | null,
): Promise<AddExistingUserToProjectResult> {
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true },
  });
  if (!targetUser) {
    return { ok: false, status: 404, message: "User not found" };
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: "Normal",
    },
    include: {
      team: {
        include: {
          googleAccount: true,
        },
      },
    },
  });

  if (!project) {
    return { ok: false, status: 404, message: "Project not found" };
  }

  if (project.ownerId === userId) {
    return {
      ok: true,
      outcome: "already_member",
      member: {
        id: null,
        userId,
        displayName: targetUser.displayName,
        email: targetUser.email,
      },
    };
  }

  const existingMember = await prisma.member.findFirst({
    where: {
      userId,
      projectId,
      agentId: null,
    },
    select: { id: true },
  });
  if (existingMember) {
    await expirePendingInvites(projectId, targetUser.email, inviterUserId, actingAgentId).catch((error) => {
      if (error instanceof AgentBoardInviteScopeError) throw error;
      console.error(
        "[addExistingUserToProject] failed to expire pending invites:",
        error,
      );
    });
    return {
      ok: true,
      outcome: "already_member",
      member: {
        id: existingMember.id,
        userId,
        displayName: targetUser.displayName,
        email: targetUser.email,
      },
    };
  }

  if (!project.teamId || !project.team) {
    return {
      ok: false,
      status: 400,
      message: "Project has no team and cannot accept members",
    };
  }

  const team = project.team;
  const teamId = project.teamId;
  const ownsTheTeam = team.googleAccount.userId === userId;

  const memberTeamCheck = await prisma.member_Team.findFirst({
    where: {
      userId,
      teamId,
      status: "Accepted",
    },
  });

  const needsNewTeamSeat =
    Boolean(team.stripe_customer_id) && !memberTeamCheck && !ownsTheTeam;

  if (needsNewTeamSeat) {
    const { value } = await mutateAndSyncSeatBilling<JoinMutationResult>(
      teamId,
      async (assertHeld) => {
        assertHeld();
        try {
          const joined = await prisma.$transaction(async (tx) => {
            await assertAgentBoardInviteScope(tx.member, projectId, inviterUserId!, actingAgentId);
            assertHeld();
            const { member: memberTeam, created } = await ensureTeamMembership(
              {
                teamId,
                userId,
                googleAccountId: team.googleAccountId,
              },
              tx.member_Team as unknown as Parameters<
                typeof ensureTeamMembership
              >[1],
            );

            assertHeld();
            const acceptedTeamMember = await tx.member_Team.findUnique({
              where: { userId_teamId: { userId, teamId } },
              select: { status: true },
            });
            if (acceptedTeamMember?.status !== "Accepted") {
              throw new Error("team_membership_not_accepted");
            }

            const alreadyMember = await tx.member.findFirst({
              where: { projectId, userId, agentId: null },
              select: { id: true },
            });
            if (alreadyMember) {
              return {
                memberId: alreadyMember.id,
                outcome: "already_member" as const,
                created: false,
              };
            }

            assertHeld();
            const member = await tx.member.create({
              data: { userId, projectId },
              select: { id: true },
            });

            if (created) {
              assertHeld();
              const updatedTeam = await tx.team.update({
                where: { id: teamId },
                data: { totalSeats: { increment: 1 } },
              });
              createLog({
                log: `${memberTeam?.user.displayName} joined Team "${team.title}"`,
                type: LogType.Team,
                status: Status.Normal,
                LoggedById: userId,
              });
              createLog({
                log: `Team "${updatedTeam.title}" has now ${updatedTeam.totalSeats} active team members `,
                type: LogType.Team,
                status: Status.Normal,
                LoggedById: userId,
              });
            }

            const analyticsKey = await enqueueMemberJoined(tx, member.id, userId, projectId, null, inviterUserId);
            return {
              analyticsKey,
              memberId: member.id,
              outcome: "added" as const,
              created,
            };
          }, actingAgentId ? { isolationLevel: "Serializable" } : undefined);

          if (joined.analyticsKey) processAnalyticsIntentSoon(joined.analyticsKey);
          return {
            value: {
              memberId: joined.memberId,
              outcome: joined.outcome,
            } satisfies JoinMutationResult,
            sync: joined.created,
          };
        } catch (error) {
          if (error instanceof AgentBoardInviteScopeError) throw error;
          console.error(
            "[addExistingUserToProject] transactional join failed:",
            error,
          );
          return {
            value: {
              memberId: null,
              outcome: "added",
              error:
                "Team membership could not be completed for this project. No board member was created.",
            } satisfies JoinMutationResult,
            sync: false,
          };
        }
      },
    );

    if (value.error || value.memberId == null) {
      return {
        ok: false,
        status: 400,
        message:
          value.error ??
          "Team membership could not be completed for this project. No board member was created.",
      };
    }

    await expirePendingInvites(projectId, targetUser.email, inviterUserId, actingAgentId).catch((error) => {
      if (error instanceof AgentBoardInviteScopeError) throw error;
      console.error(
        "[addExistingUserToProject] failed to expire pending invites:",
        error,
      );
    });
    if (value.outcome === "added") {
      await updateTrial(userId).catch((error) => {
        console.error(
          "[addExistingUserToProject] failed to update trial after join:",
          error,
        );
      });
    }
    return {
      ok: true,
      outcome: value.outcome,
      member: {
        id: value.memberId,
        userId,
        displayName: targetUser.displayName,
        email: targetUser.email,
      },
    };
  }

  if (!memberTeamCheck && !ownsTheTeam) {
    return {
      ok: false,
      status: 400,
      message:
        "Could not add user to project. Team seat billing blocked the join or the team cannot accept members.",
    };
  }

  let join: JoinMutationResult = {
    memberId: null,
    outcome: "added",
    error: "Team membership could not be completed for this project. No board member was created.",
  };

  await withTeamSeatBillingLock(teamId, async (assertHeld) => {
    const joined = await prisma.$transaction(async (tx) => {
      await assertAgentBoardInviteScope(tx.member, projectId, inviterUserId!, actingAgentId);
      const result = await ensureProjectMemberRow(tx, {
        assertHeld,
        projectId,
        userId,
        ownsTheTeam,
        teamId,
      });
      const analyticsKey = result.outcome === "added" && result.memberId !== null
        ? await enqueueMemberJoined(tx, result.memberId, userId, projectId, null, inviterUserId) : null;
      return { result, analyticsKey };
    }, actingAgentId ? { isolationLevel: "Serializable" } : undefined);
    join = joined.result;
    if (joined.analyticsKey) processAnalyticsIntentSoon(joined.analyticsKey);
  });

  if (join.memberId == null) {
    return {
      ok: false,
      status: 400,
      message:
        join.error ??
        "Team membership could not be completed for this project. No board member was created.",
    };
  }

  await expirePendingInvites(projectId, targetUser.email, inviterUserId, actingAgentId).catch((error) => {
    if (error instanceof AgentBoardInviteScopeError) throw error;
    console.error(
      "[addExistingUserToProject] failed to expire pending invites:",
      error,
    );
  });
  if (join.outcome === "added") {
    await updateTrial(userId).catch((error) => {
      console.error(
        "[addExistingUserToProject] failed to update trial after join:",
        error,
      );
    });
  }
  return {
    ok: true,
    outcome: join.outcome,
    member: {
      id: join.memberId,
      userId,
      displayName: targetUser.displayName,
      email: targetUser.email,
    },
  };
}

async function ensureProjectMemberRow(db: Prisma.TransactionClient, input: {
  assertHeld: () => void;
  projectId: number;
  userId: number;
  ownsTheTeam: boolean;
  teamId: string;
}): Promise<JoinMutationResult> {
  const { assertHeld, projectId, userId, ownsTheTeam, teamId } = input;
  assertHeld();
  const acceptedTeamMember = await db.member_Team.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { status: true },
  });
  assertHeld();
  if (acceptedTeamMember?.status !== "Accepted" && !ownsTheTeam) {
    return {
      memberId: null,
      outcome: "added",
      error:
        "Team membership could not be completed for this project. No board member was created.",
    };
  }

  const alreadyMember = await db.member.findFirst({
    where: {
      projectId,
      userId,
      agentId: null,
    },
  });
  if (alreadyMember) {
    return { memberId: alreadyMember.id, outcome: "already_member" };
  }

  assertHeld();
  const member = await db.member.create({
    data: {
      userId,
      projectId,
    },
    select: { id: true },
  });
  return { memberId: member.id, outcome: "added" };
}

async function expirePendingInvites(
  projectId: number,
  email: string | null,
  inviterUserId: number | null,
  actingAgentId?: string | null,
): Promise<void> {
  if (!email) return;
  const expire = (database: Pick<Prisma.TransactionClient, "invite">) => database.invite.updateMany({
    where: {
      projectId,
      expired: false,
      emails: { has: email },
    },
    data: { expired: true },
  });
  if (actingAgentId) {
    await prisma.$transaction(async (tx) => {
      await assertAgentBoardInviteScope(tx.member, projectId, inviterUserId!, actingAgentId);
      await expire(tx);
    }, { isolationLevel: "Serializable" });
  } else {
    await expire(prisma);
  }
}
