import prisma from "@/lib/prisma";
import { mutateAndSyncSeatBilling } from "@/lib/syncSeatBilling";
import getFirst from "../projects/getFirst";

type LeaveTeamMutationStatus = "success" | "not_found" | "forbidden";

export async function leaveTeam(
  teamId: string,
  userId: number,
  requestingUserId: number,
) {
  try {
    console.log("🤔 ~ Starting team exit operations.");

    // Keep authorization and every related database mutation atomic, then retain
    // the team lease until Stripe reflects the committed membership count.
    const { value: mutationStatus } = await mutateAndSyncSeatBilling(
      teamId,
      async (assertHeld) => {
        assertHeld();
        return prisma.$transaction(async (tx) => {
          const team = await tx.team.findUnique({
            where: { id: teamId },
            select: { googleAccount: { select: { userId: true } } },
          });
          if (!team) {
            return {
              value: "not_found" as LeaveTeamMutationStatus,
              sync: false,
            };
          }

          const isOwner = team.googleAccount.userId === requestingUserId;
          const isLeavingSelf = userId === requestingUserId;
          if (!isOwner && !isLeavingSelf) {
            return {
              value: "forbidden" as LeaveTeamMutationStatus,
              sync: false,
            };
          }

          assertHeld();
          const removed = await tx.member_Team.deleteMany({
            where: {
              userId,
              teamId,
              ...(isLeavingSelf
                ? {}
                : { team: { googleAccount: { userId: requestingUserId } } }),
            },
          });
          if (removed.count !== 1) {
            return {
              value: "success" as LeaveTeamMutationStatus,
              sync: false,
            };
          }

          assertHeld();
          await tx.assignees.deleteMany({
            where: {
              task: { project: { teamId } },
              userId,
            },
          });
          console.log("🤔 ~ Team exit status: REMOVED FROM ASSIGNEES.");

          assertHeld();
          await tx.follower.deleteMany({
            where: {
              userId,
              task: { project: { teamId } },
            },
          });
          console.log("🤔 ~ Team exit status: REMOVED AS FOLLOWERS.");

          assertHeld();
          await tx.member.deleteMany({
            where: {
              userId,
              project: { teamId },
            },
          });
          console.log("🤔 ~ Team exit status: REMOVED FROM PROJECTS.");

          console.log("🤔 ~ Team exit status: REMOVED FROM TEAM.");

          assertHeld();
          const updatedTeam = await tx.team.updateMany({
            where: {
              id: teamId,
              ...(isLeavingSelf
                ? {}
                : { googleAccount: { userId: requestingUserId } }),
            },
            data: { totalSeats: { decrement: 1 } },
          });
          if (updatedTeam.count !== 1) {
            // Throwing from the interactive transaction rolls every deletion back.
            throw new Error("Team ownership changed during member removal");
          }

          return {
            value: "success" as LeaveTeamMutationStatus,
            sync: true,
          };
        });
      },
      { exact: true },
    );

    if (mutationStatus === "not_found") {
      return { status: 404, json: { message: "Team not found" } };
    }
    if (mutationStatus === "forbidden") {
      return {
        status: 403,
        json: { message: "Only the team owner can remove members" },
      };
    }

    console.log("🤔 ~ Team exit status: TEAM SEATS DECREMENTED.");

    const firstProject = await getFirst(userId);
    return {
      status: 200,
      json: { message: "Success", firstProject },
    };
  } catch (error) {
    console.log("🤔 ~ leaveTeam ~ error:", error);
    return {
      status: 400,
      json: { message: JSON.stringify(error) },
    };
  }
}
