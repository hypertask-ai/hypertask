import prisma from "@/lib/prisma";
import { publicAgentSelect } from "@/lib/agents/publicAgent";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";

const assigneesGetAll = async (
  taskId: string | string[],
  requestingUserId: number,
) => {
  try {
    const assignees = await prisma.assignees.findMany({
      where: {
        taskId: parseInt(taskId as string),
        OR: [
          { agentId: null },
          { agent: boardAgentVisibilityWhere(requestingUserId) },
        ],
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
