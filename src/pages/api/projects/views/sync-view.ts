import prisma from "@/lib/prisma";
import { sanitizeViewBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { NextApiHandler } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { savedViewBoardAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { acquireBoardFilterWriteLock } from "@/utils/controllers/projects/views/boardFilterWriteLock";
import type { Prisma } from "@prisma/client";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  if (!session) return res.status(401).json({ message: "Unauthorized" });
  const userId = session.userId;
  const { projectId, board_columns_view } = req.body ?? {};
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ message: "Missing required information" });
  }
  const notFound = () => res.status(404).json({ message: "View not found on this board" });
  const boardWhere = { id: projectId, ...savedViewBoardAccessWhere(userId) };
  const viewWhere = {
    project_view: { projectId, project: savedViewBoardAccessWhere(userId) },
    OR: [{ visibility: "Public" as const }, { userId }],
  };
  const resolveTargets = async (db: Prisma.TransactionClient) => {
    if (!await db.project.findFirst({ where: boardWhere, select: { id: true } })) return null;
    const pv = await db.project_View.findUnique({ where: { projectId } });
    if (!pv) return [];
    const state = await db.user_Project_View.findUnique({ where: { user_project: { userId, project_view_id: pv.id } } });
    if (!state) return [];
    const targets: Array<{ id: string; visibility: "Public" | "Private" }> = [];
    if (state.appliedViewId) {
      const applied = await db.view.findFirst({ where: { id: state.appliedViewId, project_view_id: pv.id, ...viewWhere } });
      if (!applied) return null;
      targets.push(applied);
      if (applied.visibility === "Private") return targets;
    }
    if (pv.default_view_id) {
      const defaultView = await db.view.findFirst({ where: { id: pv.default_view_id, project_view_id: pv.id, visibility: "Public", ...viewWhere } });
      if (!defaultView) return null;
      if (!targets.some(target => target.id === defaultView.id)) targets.push(defaultView);
    }
    return targets;
  };
  try {
    const targets = await resolveTargets(prisma);
    if (!targets) return notFound();
    if (!targets.length) return res.status(200).json(undefined);
    const result = await prisma.$transaction(async tx => {
      await acquireBoardFilterWriteLock(tx, projectId);
      const currentTargets = await resolveTargets(tx);
      if (!currentTargets) return { denied: true as const };
      let updatedView;
      for (const { id, visibility } of currentTargets) {
        updatedView = await tx.view.update({ where: { id, visibility, ...viewWhere }, data: { board_columns_view } });
      }
      return { denied: false as const, updatedView };
    });
    if (result.denied) return notFound();
    return res.status(200).json(sanitizeViewBoardFilters(result.updatedView));
  } catch (error) {
    if ((error as { code?: string })?.code === "P2025") return notFound();
    return res.status(500).json(error);
  }
};

export default handler;
