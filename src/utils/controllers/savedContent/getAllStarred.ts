import { logger as htLogger } from "#logger";
import prisma from "@/lib/prisma";
import { HTPR_6516_AGENT_ATTRIBUTION_FLAG, isFeatureEnabled } from "@/lib/flags";
import {
  fetchProjectIds,
  includeSavedContentComment,
  savedCommentInclude,
} from "./helper";

export const getAllStarred = async (userId: number) => {
  try {
    const attributionEnabled = await isFeatureEnabled(
      HTPR_6516_AGENT_ATTRIBUTION_FLAG,
      userId,
    );
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
      json: { pinnedComments, starredTasks },
    };
  } catch (error) {
    htLogger.info("🚀 ~ getAllStarred ~ error:", error);
    return {
      status: 500,
      json: {},
    };
  }
};
