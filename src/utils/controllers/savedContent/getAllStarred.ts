import prisma from "@/lib/prisma";
import { fetchProjectIds, includeSavedContentComment } from "./helper";

export const getAllStarred = async (userId: number) => {
  try {
    const starredTasks = await prisma.savedContent.findMany({
      where: {
        userId,
        commentId: null,
        task: { status: { not: "Deleted" } },
        type: "Private",
      },
      include: {
        task: includeSavedContentComment(userId, false),
      },
      orderBy: {
        task: {
          updatedAt: "desc",
        },
      },
    });

    const projectIds = await fetchProjectIds(userId);

    const pinnedComments = await prisma.savedContent.findMany({
      where: {
        userId,
        commentId: { not: null },
        projectId: { in: projectIds },
        type: "Private",
      },
      include: {
        task: includeSavedContentComment(userId),
        comment: {
          include: {
            creator: true,
          },
        },
      },
      orderBy: {
        task: {
          updatedAt: "desc",
        },
      },
    });

    return {
      status: 200,
      json: { pinnedComments, starredTasks },
    };
  } catch (error) {
    console.log("🚀 ~ getAllStarred ~ error:", error);
    return {
      status: 500,
      json: {},
    };
  }
};
