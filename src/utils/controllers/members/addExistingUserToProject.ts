import { LogType, Status } from "@prisma/client";

import prisma from "@/lib/prisma";
import { withTeamSeatBillingLock } from "@/lib/seatBillingLock";
import { mutateAndSyncSeatBilling } from "@/lib/syncSeatBilling";
import { ensureTeamMembership } from "@/lib/teamMembership";
import { CreateLogInput } from "@/models/model";
import createLog from "@/utils/controllers/logs/createLog";
import { updateTrial } from "@/utils/controllers/members/updateTrial";

export type AddExistingUserToProjectResult =
  | {
      ok: true;
      outcome: "added" | "already_member";
      member: {
        id: number;
        userId: number;
        displayName: string | null;
        email: string | null;
      };
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

/**
 * Add an existing Hypertask user to a project board, creating team membership
 * and syncing seat billing the same way task-share join and invite accept do.
 * Does not send email invites. Idempotent when the user is already a member.
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
        id: userId,
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

  const memberTeamCheck =
    project.teamId && project.team
      ? await prisma.member_Team.findFirst({
          where: {
            userId,
            teamId: project.team.id,
            status: "Accepted",
          },
        })
      : null;

  const ownsTheTeam =
    project.team != null && project.team.googleAccount.userId === userId;

  let paymentResponse: "Awaiting" | "FREE" | "OK" = "Awaiting";

  if (
    project.teamId &&
    project.team?.stripe_customer_id &&
    !memberTeamCheck &&
    !ownsTheTeam
  ) {
    const teamId = project.teamId;
    const team = project.team;
    // Seat billing runs once, after the member is added, so it can price against
    // the team's real seat count. Charging here as well is what double-billed a
    // seat (HTPR-4216).
    paymentResponse =
      project.team.subscriptionPlan.length === 0 ? "FREE" : "OK";

    if (paymentResponse === "OK" || paymentResponse === "FREE") {
      await mutateAndSyncSeatBilling(teamId, async (assertHeld) => {
        assertHeld();
        const { member: memberTeam, created } = await ensureTeamMembership({
          teamId,
          userId,
          googleAccountId: team.googleAccountId,
        });

        if (!created) return { value: undefined, sync: false };

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

        return { value: undefined, sync: true };
      });
    }
  }

  const mayJoinProject =
    Boolean(project.teamId) &&
    Boolean(
      memberTeamCheck ||
        paymentResponse === "OK" ||
        paymentResponse === "FREE" ||
        ownsTheTeam,
    );

  if (!mayJoinProject) {
    return {
      ok: false,
      status: 400,
      message:
        "Could not add user to project. Team seat billing blocked the join or the team cannot accept members.",
    };
  }

  let createdMemberId: number | null = null;
  let outcome: "added" | "already_member" = "added";

  await withTeamSeatBillingLock(project.teamId!, async (assertHeld) => {
    assertHeld();
    const acceptedTeamMember = await prisma.member_Team.findUnique({
      where: { userId_teamId: { userId, teamId: project.teamId! } },
      select: { status: true },
    });
    assertHeld();
    if (acceptedTeamMember?.status !== "Accepted" && !ownsTheTeam) return;

    const alreadyMember = await prisma.member.findFirst({
      where: {
        projectId,
        userId,
        agentId: null,
      },
    });
    if (alreadyMember) {
      createdMemberId = alreadyMember.id;
      outcome = "already_member";
      return;
    }

    assertHeld();
    const member = await prisma.member.create({
      data: {
        userId,
        projectId,
      },
      select: { id: true },
    });
    createdMemberId = member.id;
    await updateTrial(userId);
  });

  if (createdMemberId == null && !ownsTheTeam) {
    // Team membership may have been created without project membership if the
    // accepted-status check failed after billing. Report failure rather than
    // success so callers do not assume board access exists.
    return {
      ok: false,
      status: 400,
      message:
        "Team membership could not be completed for this project. No board member was created.",
    };
  }

  if (targetUser.email) {
    await prisma.invite.updateMany({
      where: {
        projectId,
        expired: false,
        emails: { has: targetUser.email },
      },
      data: { expired: true },
    });
  }

  return {
    ok: true,
    outcome,
    member: {
      id: createdMemberId ?? userId,
      userId,
      displayName: targetUser.displayName,
      email: targetUser.email,
    },
  };
}
