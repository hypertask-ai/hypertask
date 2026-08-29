import prisma from "@/lib/prisma";
import { publicAgentSelect } from "@/lib/agents/publicAgent";

const assigneesGetAll = async (taskId: string | string[]) => {
  try {
    const assignees = await prisma.assignees.findMany({
      where: {
        taskId: parseInt(taskId as string),
      },
      include: {
        user: true,
        agent: { select: publicAgentSelect },
      },
    });
    return {
      status: 200,
      json: assignees,
    };
  } catch (error) {
    console.log("🚀 ~ assigneesGetAll ~ error:", error);
    return {
      status: 500,
      json: { error: error },
    };
  }
};

export default assigneesGetAll;
