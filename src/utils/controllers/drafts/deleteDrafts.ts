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
    console.log("🚀 ~ draftsToDelete:", draftsToDelete);

    return {
      status: 200,
    };
  } catch (error) {
    console.log("🚀 ~ deleteProject ~ error:", error);
    return {
      status: 500,
      json: { error: "Failed to add new section" },
    };
  }
};

export default deleteDrafts;
