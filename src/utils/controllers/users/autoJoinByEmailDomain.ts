import { LogType, Status } from "@prisma/client";

import { domainOfEmail } from "@/lib/auth/emailDomain";
import { isSubscriptionActive } from "@/lib/constants/constants";
import prisma from "@/lib/prisma";
import { withTeamSeatBillingLock } from "@/lib/seatBillingLock";
import { mutateAndSyncSeatBilling } from "@/lib/syncSeatBilling";
import { ensureTeamMembership } from "@/lib/teamMembership";
import { CreateLogInput } from "@/models/model";

import createLog from "../logs/createLog";

// Adds a freshly provisioned user to every team that allowlisted their email domain,
// billing a seat exactly as a manual invite would (mirrors members/share.ts addToTeam).
// Called from provisionNewUser, the one place both the legacy and Better Auth signup
// paths create a user, so a new signup on either path gets the same treatment.
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
    // A team with no Stripe customer cannot be seat-billed, so it cannot take members.
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
      // Plans that are canceled/past_due/unpaid pass the not-Expired query filter
      // but fail isSubscriptionActive. Without this guard, retrieve(undefined)
      // throws and aborts auto-join for every remaining matching team.
      if (!paymentPlan?.subscriptionItemId) continue;
      // Seat billing runs once, after the member is added, so it can price against the
      // team's real seat count. Charging here as well is what double-billed a seat
      // (HTPR-4216).
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

      // Board visibility comes from Member, not Member_Team (getProjectWhere checks
      // ownerId + Member), so grant it under the same lock used by team leave.
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
