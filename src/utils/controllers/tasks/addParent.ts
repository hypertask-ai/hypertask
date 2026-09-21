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
  console.log("🚀 ~ AddParentTask ~ updated:", updated);

  return {
    status: 200,
    json: updated,
  };
};

export default AddParentTask;
