import { LogType, Status } from "@prisma/client";

import prisma from "@/lib/prisma";
import { withTeamSeatBillingLock } from "@/lib/seatBillingLock";
import { mutateAndSyncSeatBilling } from "@/lib/syncSeatBilling";
import { ensureTeamMembership } from "@/lib/teamMembership";
import { CreateLogInput } from "@/models/model";
import createLog from "@/utils/controllers/logs/createLog";
import { updateTrial } from "@/utils/controllers/members/updateTrial";

export type AddedProjectMember = {
  /** Project Member row id, or null when the user is the board owner (no Member row). */
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

/**
 * Add an existing Hypertask user to a project board, creating team membership
 * and syncing seat billing the same way task-share join and invite accept do.
 * Does not send email invites. Idempotent when the user is already a member.
 *
 * Team seat creation and board Member creation run in one billing lock so a
 * failed board add cannot leave a billed seat without project access.
 */
export async function addExistingUserToProject(
  projectId: number,
  userId: number,
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
          subscriptionPlan: {
            where: {
              subscriptionStatus: { not: "Expired" },
            },
          },
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
    // Seat billing runs once after both team and board membership exist
    // (HTPR-4216). Keep both writes inside this lock so sync cannot charge a
    // seat when board membership fails.
    const paymentResponse =
      team.subscriptionPlan.length === 0 ? "FREE" : "OK";
    if (paymentResponse !== "OK" && paymentResponse !== "FREE") {
      return {
        ok: false,
        status: 400,
        message:
          "Could not add user to project. Team seat billing blocked the join or the team cannot accept members.",
      };
    }

    const { value } = await mutateAndSyncSeatBilling<JoinMutationResult>(
      teamId,
      async (assertHeld) => {
        assertHeld();
        const priorTeamMembership = await prisma.member_Team.findUnique({
          where: { userId_teamId: { userId, teamId } },
          select: { status: true },
        });
        assertHeld();
        const { member: memberTeam, created } = await ensureTeamMembership({
          teamId,
          userId,
          googleAccountId: team.googleAccountId,
        });

        assertHeld();
        const board = await ensureProjectMemberRow({
          assertHeld,
          projectId,
          userId,
          ownsTheTeam: false,
          teamId,
        });
        if (board.error || board.memberId == null) {
          // Undo the team-seat mutation so billing never syncs a seat without
          // board access. Fresh rows are removed; promoted Invited rows revert.
          if (created) {
            assertHeld();
            if (!priorTeamMembership) {
              await prisma.member_Team
                .delete({ where: { userId_teamId: { userId, teamId } } })
                .catch(() => undefined);
            } else if (priorTeamMembership.status === "Invited") {
              await prisma.member_Team.update({
                where: { userId_teamId: { userId, teamId } },
                data: { status: "Invited", acceptedAt: null },
              });
            }
          }
          return {
            value: {
              memberId: null,
              outcome: "added",
              error:
                board.error ??
                "Team membership could not be completed for this project. No board member was created.",
            } satisfies JoinMutationResult,
            sync: false,
          };
        }

        if (!created) {
          return {
            value: {
              memberId: board.memberId,
              outcome: board.outcome,
            } satisfies JoinMutationResult,
            sync: false,
          };
        }

        const createLogBody: CreateLogInput = {
          log: `${memberTeam?.user.displayName} joined Team "${team.title}"`,
          type: LogType.Team,
          status: Status.Normal,
          LoggedById: userId,
        };
        createLog(createLogBody);

        assertHeld();
        const updatedTeam = await prisma.team.update({
          where: { id: teamId },
          data: { totalSeats: { increment: 1 } },
        });
        const createLogBody2: CreateLogInput = {
          log: `Team "${updatedTeam.title}" has now ${updatedTeam.totalSeats} active team members `,
          type: LogType.Team,
          status: Status.Normal,
          LoggedById: userId,
        };
        createLog(createLogBody2);

        return {
          value: {
            memberId: board.memberId,
            outcome: board.outcome,
          } satisfies JoinMutationResult,
          sync: true,
        };
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

    await expirePendingInvites(projectId, targetUser.email);
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
    join = await ensureProjectMemberRow({
      assertHeld,
      projectId,
      userId,
      ownsTheTeam,
      teamId,
    });
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

  await expirePendingInvites(projectId, targetUser.email);
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

async function ensureProjectMemberRow(input: {
  assertHeld: () => void;
  projectId: number;
  userId: number;
  ownsTheTeam: boolean;
  teamId: string;
}): Promise<JoinMutationResult> {
  const { assertHeld, projectId, userId, ownsTheTeam, teamId } = input;
  assertHeld();
  const acceptedTeamMember = await prisma.member_Team.findUnique({
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

  const alreadyMember = await prisma.member.findFirst({
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
  const member = await prisma.member.create({
    data: {
      userId,
      projectId,
    },
    select: { id: true },
  });
  await updateTrial(userId);
  return { memberId: member.id, outcome: "added" };
}

async function expirePendingInvites(
  projectId: number,
  email: string | null,
): Promise<void> {
  if (!email) return;
  await prisma.invite.updateMany({
    where: {
      projectId,
      expired: false,
      emails: { has: email },
    },
    data: { expired: true },
  });
}
