import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { withAgentScopeRequest } from "@/lib/auth/agentScope";
import generateRank from "@/utils/generateRank";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { taskWriteHandler } from "@/lib/api/task-writes/route";

const getDefaults: NextApiHandler = (req, res) =>
  withAgentScopeRequest(req, () => loadDefaults(req, res));

const loadDefaults: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    const requestStartedAt = performance.now();
    try {
      const { sectionId, projectId, position } = req.query;

      if (!projectId)
        return res.status(400).json({ message: "Missing project Id!" });
      let ranking;
      const project_id = Number(projectId);
      if (!Number.isInteger(project_id) || project_id <= 0) {
        return res.status(400).json({ message: "Invalid project id" });
      }
      const session = await getSessionUser(
        new Headers(req.headers as Record<string, string>)
      );
      if (!session) return res.status(401).json({ message: "Unauthorized" });

      const authorizedProject = await prisma.project.findFirst({
        where: {
          id: project_id,
          status: "Normal",
          ...taskWriteAccessWhere(session.userId, null),
          AND: [taskWriteAccessWhere(session.userId, session.agentId, session.teamScope)],
        },
        select: { id: true },
      });
      if (!authorizedProject) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const requestedSectionId = Number(sectionId);
      const requestedSection = Number.isInteger(requestedSectionId)
        ? await prisma.section.findFirst({
            where: {
              id: requestedSectionId,
              projectId: project_id,
              visibility: true,
              deleted: false,
            },
          })
        : null;
      const section =
        requestedSection ??
        (await prisma.section.findFirst({
          where: {
            visibility: true,
            deleted: false,
            projectId: project_id,
          },
          orderBy: { ranking: "asc" },
        }));
      if (!section) {
        return res.status(404).json({ message: "No active section found" });
      }
      console.log("🚀 ~ consthandler:NextApiHandler= ~ section:", section);
      const task = await prisma.task.findFirst({
        where: {
          sectionId: section.id,
          projectId: project_id,
          status: "Normal",
          project: taskWriteAccessWhere(session.userId, session.agentId, session.teamScope),
        },
        orderBy: {
          ranking: position === "top" ? "asc" : "desc",
        },
      });
      console.log("🚀 ~ consthandler:NextApiHandler= ~ task:", task);

      if (position === "bottom") {
        ranking = generateRank(task ? task.ranking : undefined, undefined);
      } else {
        ranking = generateRank(undefined, task ? task.ranking : undefined);
      }
      console.log("🚀 ~ consthandler:NextApiHandler= ~ ranking:", ranking);
      const body = {
        section: section.section_title,
        ranking,
        sectionId: section.id,
      };
      console.log("🚀 ~ consthandler:NextApiHandler= ~ body:", body);
      res.setHeader(
        "Server-Timing",
        `total;dur=${(performance.now() - requestStartedAt).toFixed(1)}`,
      );
      res.status(200).json(body);
    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error);
      res.status(500).json({ message: "Could not load task defaults" });
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default taskWriteHandler({
  POST: async () => (await import("@/lib/api/task-writes/create-global")).POST,
}, { fallback: getDefaults });
