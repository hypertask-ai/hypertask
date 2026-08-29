import { LogType, PrismaClient, Status } from "@prisma/client";
import { CreateLogInput } from "@/models/model";
import createLog from "../logs/createLog";

import prisma from "@/lib/prisma";
import { withTeamSeatBillingLock } from "@/lib/seatBillingLock";
import { ensureTeamMembership } from "@/lib/teamMembership";
import { updateTrial } from "./updateTrial";
import { mutateAndSyncSeatBilling } from "@/lib/syncSeatBilling";

const membersShare = async (userId: number, shareId: string) => {
  try {
    if (!userId || !shareId) {
      return {
        status: 400,
        json: { message: "Missing required information", allowShare: false },
      };
    }
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      return {
        status: 400,
        json: { message: "User not found", allowShare: false },
      };
    }

    const taskShared = await prisma.taskSharing.findFirst({
      where: {
        id: shareId,
      },
      include: {
        task: {
          select: {
            uniqueIndex: true,
          },
        },
        user: true,
      },
    });

    // const defaultDomains = ["gmail.com", "outlook.com", "yahoo.com"];

    if (taskShared) {
      if (taskShared.shareType === "Domain") {
        //Okay for this case we only need to check if the user is already part of the team. If not then the user will
        //just go their own board or sth.

        const project = await prisma.project.findFirst({
          where: {
            id: taskShared.projectId,
            OR: [
              {
                members: {
                  some: {
                    userId: user.id,
                  },
                },
              },
              {
                ownerId: {
                  in: [user.id],
                },
              },
            ],
          },
        });

        //meaning user is part of project then let them through. man i really need to clean up this file.
        if (project) {
          return { status: 200, json: { taskShared, allowShare: true } };
        } else {
          return { status: 200, json: { taskShared, allowShare: false } };
        }
      } else if (taskShared?.shareType === "Anyone") {
        //get user email domain
        const res = await addToTeam(taskShared.projectId, user.id);
        if (res)
          return { status: 200, json: { taskShared, allowShare: true } };
        else
          return {
            status: 400,
            json: { message: "Cannot join board", allowShare: false },
          };
      }

      return { status: 200, json: { taskShared, allowShare: true } };
    }

    return {
      status: 400,
      json: { message: "Did not find sharelink", allowShare: false },
    };
  } catch (error) {
    console.log(error);
    return { status: 500, json: { message: JSON.stringify(error) } };
  }
};

const isEmailFromAllowedDomain = (
  email: string,
  domainEmail: string
): boolean => {
  const emailDomain = email.split("@")[1];
  const domain = domainEmail.split("@")[1];
  return emailDomain === domain;
};

const addToTeam = async (projectId: number, userId: number) => {
  try {
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
      return false;
    }

    if (project.ownerId === userId) {
      return true;
    }

    let member = await prisma.member.findFirst({
      where: {
        userId,
        projectId,
        agentId: null,
      },
      include: {
        user: true,
      },
    });
    console.log(member);
    if (member) {
      return true;
    }

    const member_teamCheck = await prisma.member_Team.findFirst({
      where: {
        userId: userId,
        teamId: project.team?.id,
        status: "Accepted",
      },
    });
    const ownsTheTeam = await prisma.team.findUnique({
      where: {
        id: project.team?.id,
      },
      include: {
        googleAccount: true,
      },
    });

    var PaymentResponse: "Awaiting" | "FREE" | "OK" =
      "Awaiting";

    if (
      project.teamId &&
      project.team?.stripe_customer_id &&
      !member_teamCheck &&
      ownsTheTeam?.googleAccount.userId !== userId
    ) {
      const teamId = project.teamId;
      const team = project.team;
      // Seat billing runs once, after the member is added, so it can price against the
      // team's real seat count. Charging here as well is what double-billed a seat
      // (HTPR-4216).
      PaymentResponse =
        project.team.subscriptionPlan.length === 0 ? "FREE" : "OK";

      if (PaymentResponse === "OK" || PaymentResponse === "FREE") {
        // CREATE new instance of MEMBER_TEAM if doesnt exist before

        await mutateAndSyncSeatBilling(teamId, async (assertHeld) => {
          assertHeld();
          const { member: member_team, created } = await ensureTeamMembership({
            teamId,
            userId: userId,
            googleAccountId: team.googleAccountId,
          });

          if (!created) return { value: undefined, sync: false };
        let createLogBody: CreateLogInput = {
          log: `${member_team?.user.displayName} joined Team "${team.title}"`,
          type: LogType.Team,
          status: Status.Normal,
          LoggedById: userId,
        };
        createLog(createLogBody);

        // update total_seats of the team
        assertHeld();
        const updatedTeam = await prisma.team.update({
          where: {
            id: teamId,
          },
          data: {
            totalSeats: {
              increment: 1,
            },
          },
        });
        let createLogBody2: CreateLogInput = {
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

    if (
      project.teamId &&
      (member_teamCheck ||
        PaymentResponse === "OK" ||
        PaymentResponse === "FREE" ||
        ownsTheTeam)
    ) {
      await withTeamSeatBillingLock(project.teamId!, async (assertHeld) => {
      assertHeld();
      const acceptedTeamMember = await prisma.member_Team.findUnique({
        where: { userId_teamId: { userId, teamId: project.teamId! } },
        select: { status: true },
      });
      assertHeld();
      if (acceptedTeamMember?.status !== "Accepted") return;
      // ================================ create a member of the project if he isn't a member
      const alreadyMember = await prisma.member.findFirst({
        where: {
          projectId,
          userId,
          agentId: null,
        },
      });
      const owner = await prisma.project.findMany({
        where: {
          id: projectId,
          ownerId: userId,
        },
      });
      if (!alreadyMember && owner.length === 0) {
        // yeah i know its bad but for some reason this block runs twice
        const doubleCheck = await prisma.member.findFirst({
          where:{
            projectId,
            userId,
            agentId: null
        }
        });
        if (!doubleCheck) {
          assertHeld();
          member = await prisma.member.create({
            data: {
              userId: userId,
              projectId: projectId,
            },
            include: {
              user: true,
              project: {
                include: {
                  team: true,
                },
              },
            },
          });
          //Only in the case of task sharing is that we are having onboarding status true, but not the tutorial status
          // updateUserSettingOnboarding(userId, true);
          updateTrial(userId);
          assertHeld();
        }
      }
      });
    }

    return true;
  } catch (error: any) {
    console.log("🚀 ~ addToTeam ~ error:", error);
    return false;
  }
};

export default membersShare;
