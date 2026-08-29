import prisma from "@/lib/prisma";
import { mutateAndSyncSeatBilling } from "@/lib/syncSeatBilling";
import getFirst from "../projects/getFirst";

export async function leaveTeam(teamId: string, userId: number) {
  try {
    console.log("🤔 ~ Starting team exit operations.");
    await prisma.assignees.deleteMany({
      where: {
        task: {
          project: {
            teamId: teamId,
          },
        },
        userId: userId,
      },
    });
    console.log("🤔 ~ Team exit status: REMOVED FROM ASSIGNEES.");

    await prisma.follower.deleteMany({
      where: {
        userId: userId,
        task: {
          project: {
            teamId: teamId,
          },
        },
      },
    });
    console.log("🤔 ~ Team exit status: REMOVED AS FOLLOWERS.");

    // Keep membership removal, the cached counter, and Stripe reconciliation in
    // one team lease so a concurrent join cannot invoice a departed member.
    await mutateAndSyncSeatBilling(
      teamId,
      async (assertHeld) => {
        assertHeld();
        await prisma.member.deleteMany({
          where: {
            userId: userId,
            project: {
              teamId: teamId,
            },
          },
        });
        console.log("🤔 ~ Team exit status: REMOVED FROM PROJECTS.");

        assertHeld();
        const removed = await prisma.member_Team.deleteMany({
          where: {
            userId: userId,
            teamId: teamId,
          },
        });
        if (removed.count === 0) return { value: undefined, sync: false };

        console.log("🤔 ~ Team exit status: REMOVED FROM TEAM.");
        assertHeld();
        await prisma.team.update({
          where: {
            id: teamId,
          },
          data: {
            totalSeats: {
              decrement: 1,
            },
          },
        });
        return { value: undefined, sync: true };
      },
      { exact: true },
    );

    console.log("🤔 ~ Team exit status: TEAM SEATS DECREMENTED.");

    //For rerouting
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
