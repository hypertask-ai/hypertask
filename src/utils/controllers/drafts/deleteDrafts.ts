import { logger as htLogger } from "#logger";
import prisma from "@/lib/prisma";

const deleteDrafts = async (
  taskId: number,
  userId: number,
  draftType: "Description" | "Comment"
) => {
  try {
    const draftsToDelete = await prisma.drafts.deleteMany({
      where: {
        type: draftType,
        taskId: taskId,
        userId: userId,
      },
    });
    htLogger.info("🚀 ~ draftsToDelete:", draftsToDelete);

    return {
      status: 200,
    };
  } catch (error) {
    htLogger.info("🚀 ~ deleteProject ~ error:", error);
    return {
      status: 500,
      json: { error: "Failed to add new section" },
    };
  }
};

export default deleteDrafts;
