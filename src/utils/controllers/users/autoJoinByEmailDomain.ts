import { LogType, Status } from "@prisma/client";

import { domainOfEmail } from "@/lib/auth/emailDomain";
import { isSubscriptionActive } from "@/lib/constants/constants";
import prisma from "@/lib/prisma";
import { withTeamSeatBillingLock } from "@/lib/seatBillingLock";
import { mutateAndSyncSeatBilling } from "@/lib/syncSeatBilling";
import { ensureTeamMembership } from "@/lib/teamMembership";
import { CreateLogInput } from "@/models/model";

import createLog from "../logs/createLog";

const autoJoinByEmailDomain = async (userId: number, email: string) => {
  const emailDomain = domainOfEmail(email);
  if (!emailDomain) {
    return;
  }

  const matchingTeams = await prisma.team.findMany({
    where: {
      allowedEmailDomains: { has: emailDomain },
    },
    include: {
      googleAccount: true,
      subscriptionPlan: {
        where: { subscriptionStatus: { not: "Expired" } },
      },
      projects: {
        where: { status: "Normal" },
        select: { id: true },
      },
    },
  });

  for (const team of matchingTeams) {
    if (!team.stripe_customer_id) continue;
    if (team.googleAccount.userId === userId) continue;

    const existingMembership = await prisma.member_Team.findFirst({
      where: { userId, teamId: team.id, status: "Accepted" },
    });
    if (existingMembership) continue;

    let payment: "Awaiting" | "FREE" | "OK" = "Awaiting";

    if (team.subscriptionPlan.length === 0) {
      payment = "FREE";
    } else {
      const paymentPlan = team.subscriptionPlan.find((item) =>
        isSubscriptionActive(item.subscriptionStatus)
      );
      if (!paymentPlan?.subscriptionItemId) continue;
      payment = "OK";
    }

    if (payment !== "OK" && payment !== "FREE") {
      continue;
    }

    await mutateAndSyncSeatBilling(team.id, async (assertHeld) => {
      assertHeld();
      const { member: member_team, created } = await ensureTeamMembership({
        teamId: team.id,
        userId,
        googleAccountId: team.googleAccountId,
      });

      if (!created) return { value: undefined, sync: false };
    const joinLog: CreateLogInput = {
      log: `${member_team.user.displayName} auto-joined Team "${team.title}" via email domain`,
      type: LogType.Team,
      status: Status.Normal,
      LoggedById: userId,
    };
    createLog(joinLog);

    assertHeld();
    const updatedTeam = await prisma.team.update({
      where: { id: team.id },
      data: { totalSeats: { increment: 1 } },
    });

    const seatLog: CreateLogInput = {
      log: `Team "${updatedTeam.title}" has now ${updatedTeam.totalSeats} active team members`,
      type: LogType.Team,
      status: Status.Normal,
      LoggedById: userId,
    };
    createLog(seatLog);

      return { value: undefined, sync: true };
    });

    await withTeamSeatBillingLock(team.id, async (assertHeld) => {
      assertHeld();
      const acceptedTeamMember = await prisma.member_Team.findUnique({
        where: { userId_teamId: { userId, teamId: team.id } },
        select: { status: true },
      });
      assertHeld();
      if (acceptedTeamMember?.status !== "Accepted") return;

      for (const project of team.projects) {
        const alreadyMember = await prisma.member.findFirst({
          where: { userId, projectId: project.id, agentId: null },
        });
        if (!alreadyMember) {
          assertHeld();
          await prisma.member.create({
            data: { userId, projectId: project.id },
          });
          assertHeld();
        }
      }
    });
  }
};

export default autoJoinByEmailDomain;
