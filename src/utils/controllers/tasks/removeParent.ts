import prisma from "@/lib/prisma";

const RemoveParentTask = async (childId: number) => {
  const updated = await prisma.task.update({
    where: {
      id: childId,
    },
    data: {
      parentTaskId: null,
    },
  });
  console.log("🚀 ~ RemoveParentTask ~ updated:", updated);

  return {
    status: 200,
    json: updated,
  };
};

export default RemoveParentTask;
