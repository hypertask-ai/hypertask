
import { withAgentScopeRequest } from "@/lib/auth/agentScope";
import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  if (!session) return res.status(401).json({ message: "Unauthorized" });
  const { projectId } = req.query;
  const id = parseInt(projectId as string);
  if (!projectId || Number.isNaN(id))
    return res.status(400).json({ message: "Missing Required Information" });

  const access = {
    ...projectContentAccessWhere(session.userId),
    AND: [projectContentAccessWhere(session.userId, session.agentId, session.teamScope)],
  };
  const project = await prisma.project.findFirst({
    where: { AND: [{ id }, projectContentAccessWhere(session.userId), projectContentAccessWhere(session.userId, session.agentId, session.teamScope)] },
    select: { id: true },
  });
  if (!project) return res.status(404).json({ message: "Project not found" });


  const labels = await prisma.label.findMany({
    where: {
      projectId: id,
    },
    include: {
      task: {
        where: { task: { project: access } },
        include: {
          task: {
            select: {
              id: true,
              projectId: true,
              title: true,
              uniqueIndex: true,
              ticketNumber: true,
              userId: true,
              status: true,
            },
          },
        },
        orderBy: {
          id: "desc",
        },
      },
      _count: {
        select: {
          task: {
            where: {
              task: {
                status: "Normal",
                project: access,
              },
            },
          },
        },
      },
    },
    orderBy:{
      value:"asc"
    }
  });
  return res.status(200).json(labels.map((label) => ({
    ...label,
    _count: {
      ...label._count,
      archived: label.task.filter(({ task }) => task.status === "Archive").length,
    },
  })));
}

export default ((req, res) => withAgentScopeRequest(req, () => handler(req, res))) satisfies NextApiHandler;
