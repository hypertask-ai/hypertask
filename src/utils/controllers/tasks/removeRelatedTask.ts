import { logger as htLogger } from "#logger";
import prisma from "@/lib/prisma";

export const removeRelatedTask = async (relationId: number) => {
  try {
    const removed = await prisma.taskRelations.delete({
      where: {
        id: relationId,
      },
    });
    return {
      status: 200,
      json: removed,
    };
  } catch (error) {
    htLogger.info("🚀 ~ removeRelatedTask ~ error:", error);
    return {
      status: 500,
      json: undefined,
    };
  }
};
