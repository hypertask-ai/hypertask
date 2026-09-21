import { logger as htLogger } from "#logger";
import prisma from "@/lib/prisma";

const AddParentTask = async (orphanId: number, parentId: number) => {
  const updated = await prisma.task.update({
    where: {
      id: orphanId,
    },
    data: {
      parentTaskId: parentId,
    },
  });
  htLogger.info("🚀 ~ AddParentTask ~ updated:", updated);

  return {
    status: 200,
    json: updated,
  };
};

export default AddParentTask;
