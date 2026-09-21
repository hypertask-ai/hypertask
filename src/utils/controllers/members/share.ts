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

const addToTeam = async (projectId: number, userId: number) => {
  try {
    const result = await addExistingUserToProject(projectId, userId);
    // Anyone share links still grant view access when membership/billing cannot
    // complete (legacy no-op success). Missing project/user must still deny.
    if (!result.ok && result.status === 404) return false;
    return true;
  } catch (error: any) {
    console.log("🚀 ~ addToTeam ~ error:", error);
    return false;
  }
};

export default membersShare;
