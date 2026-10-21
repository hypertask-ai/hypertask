import prisma from "@/lib/prisma";
import { addExistingUserToProject } from "./addExistingUserToProject";

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


    if (taskShared) {
      if (taskShared.shareType === "Domain") {
        const project = await prisma.project.findFirst({
          where: {
            id: taskShared.projectId,
            OR: [
              {
                members: {
                  some: {
                    userId: user.id,
                    agentId: null,
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

        if (project) {
          return { status: 200, json: { taskShared, allowShare: true } };
        } else {
          return { status: 200, json: { taskShared, allowShare: false } };
        }
      } else if (taskShared?.shareType === "Anyone") {
        const res = await addToTeam(taskShared.projectId, user.id, taskShared.userId);
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

const addToTeam = async (projectId: number, userId: number, inviterUserId: number) => {
  try {
    const result = await addExistingUserToProject(projectId, userId, inviterUserId);
    if (!result.ok && result.status === 404) return false;
    return true;
  } catch (error: any) {
    console.log("🚀 ~ addToTeam ~ error:", error);
    return false;
  }
};

export default membersShare;
