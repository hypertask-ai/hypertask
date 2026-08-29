import prisma from "@/lib/prisma";
import { fetchProjectIds, includeSavedContentComment } from "./helper";

export const getAllPinned = async (userId: number) => {
  try {
    const projectIds = await fetchProjectIds(userId);
    const personalPins = await prisma.savedContent.findMany({
      where: {
        userId,
        commentId: { not: null },
        projectId: { in: projectIds },
        type: "Public",
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

    const teamPins = await prisma.savedContent.findMany({
      where: {
        userId: { not: userId },
        commentId: { not: null },
        projectId: { in: projectIds },
        type: "Public",
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
      json: { personalPins, teamPins },
    };
  } catch (error) {
    console.log("🚀 ~ getAllPinned ~ error:", error);
    return {
      status: 500,
      json: {},
    };
  }
};
