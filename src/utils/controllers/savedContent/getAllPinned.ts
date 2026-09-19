import prisma from "@/lib/prisma";
import { HTPR_6516_AGENT_ATTRIBUTION_FLAG, isFeatureEnabled } from "@/lib/flags";
import {
  fetchProjectIds,
  includeSavedContentComment,
  savedCommentInclude,
} from "./helper";

export const getAllPinned = async (userId: number) => {
  try {
    const attributionEnabled = await isFeatureEnabled(
      HTPR_6516_AGENT_ATTRIBUTION_FLAG,
      userId,
    );
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
        comment: savedCommentInclude(attributionEnabled),
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
        comment: savedCommentInclude(attributionEnabled),
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
