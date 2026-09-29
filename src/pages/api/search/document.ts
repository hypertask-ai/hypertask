import { httpStatusConfig } from "@/lib/configs/http-status.config";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { HTPR_6372_SEARCH_RANKING_FLAG, HTPR_6369_SEARCH_OPERATORS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { MAX_SEARCH_OPERATOR_CLAUSES, parseSearchWithNames, searchOperatorClauseCount } from "@/lib/search/operators";
import { rankedSearchWhere } from "@/lib/search/rankedWhere";
import prisma from "@/lib/prisma";
import { turbopufferGetDocuments } from "@/utils/controllers/search/document";
import { convertToPlain } from "@/utils/controllers/turbopuffer/turbopufferHelper";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      const { searchQuery, projectIds, archive, contextProjectId } = req.body;
      const normalizedSearchQuery =
        typeof searchQuery === "string" ? searchQuery.trim() : "";
      const requestedProjectIds = Array.isArray(projectIds)
        ? Array.from(
            new Set(
              projectIds.filter(
                (projectId): projectId is number =>
                  Number.isInteger(projectId) && projectId > 0,
              ),
            ),
          )
        : [];

      if (!normalizedSearchQuery || requestedProjectIds.length === 0) {
        return res.status(400).json("Missing Required Data");
      }

      const session = await getSessionUser(
        new Headers(req.headers as Record<string, string>),
      );
      if (!session) {
        return res
          .status(401)
          .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
      }

      const operatorsEnabled = await isFeatureEnabled(HTPR_6369_SEARCH_OPERATORS_FLAG, session.userId);
      if (operatorsEnabled && (normalizedSearchQuery.length > 200 || searchOperatorClauseCount(normalizedSearchQuery) > MAX_SEARCH_OPERATOR_CLAUSES)) {
        return res.status(400).json({ message: "Search query exceeds the operator limit or 200 characters" });
      }
      const accessibleProjects = await prisma.project.findMany({
        where: {
          id: { in: requestedProjectIds },
          status: "Normal",
          ...projectContentAccessWhere(session.userId),
        },
        select: { id: true },
      });
      if (accessibleProjects.length !== requestedProjectIds.length) {
        return res.status(403).json({ message: "Project access denied" });
      }

      const parsed = operatorsEnabled ? await parseSearchWithNames(normalizedSearchQuery, requestedProjectIds) : null;
      if (parsed && Object.keys(parsed.filters).length) {
        const { where, rankedIds, descriptionById, partial } = await rankedSearchWhere(
          parsed, requestedProjectIds, archive === "Normal" || archive === "Archive" ? archive : null,
        );
        const select = {
            id: true, projectId: true, ticketNumber: true, title: true,
            description_: { select: { content: true } }, status: true, updatedAt: true, uniqueIndex: true,
            project: { select: { title: true } },
        } as const;
        const primary = rankedIds.length ? await prisma.task.findMany({
          where: { ...where, id: { in: rankedIds.slice(0, 50) } }, select,
        }) : [];
        const rankedPrimary = primary.toSorted((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id));
        const fallback = !parsed.text ? await prisma.task.findMany({
          where, select, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 50,
        }) : [];
        const ranked = [...rankedPrimary, ...fallback].map((row) => ({
          taskId: row.id, projectId: row.projectId, ticketNumber: row.ticketNumber,
          taskTitle: row.title, descriptionText: descriptionById.get(row.id) ?? convertToPlain(row.description_?.content ?? ''),
          projectTitle: row.project.title, status: row.status,
          updatedAt: row.updatedAt?.toISOString(), uniqueIndex: row.uniqueIndex,
          highlight: {},
        }));
        const processedData: Record<string, typeof ranked> = { All: ranked };
        const tabs = ["All"];
        if (new Set(ranked.map((row) => row.status)).size > 1) {
          tabs.push("Open", "Archived");
          processedData.Open = ranked.filter((row) => row.status !== "Archive");
          processedData.Archived = ranked.filter((row) => row.status === "Archive");
        }
        for (const row of ranked) {
          const title = row.projectTitle || "Uncategorized";
          if (!processedData[title]) {
            tabs.push(title);
            processedData[title] = [];
          }
          processedData[title].push(row);
        }
        return res.status(ranked.length ? 200 : 204).json({
          processedData, tabs, contextProjectId: contextProjectId ?? null,
          ...(parsed.text && partial ? { partial: true } : {}),
          status: ranked.length ? 200 : 204,
        });
      }

      const applyRelevanceCut = await isFeatureEnabled(
        HTPR_6372_SEARCH_RANKING_FLAG,
        session.userId
      );
      const results = await turbopufferGetDocuments(
        normalizedSearchQuery,
        requestedProjectIds,
        archive,
        {
          contextProjectId,
          applyRelevanceCut,
        }
      );
      return res.status(results.status).json(results);
    } catch (error) {
      console.log("🤔 ~ handler ~ error:", error);
      return res
        .status(500)
        .json(httpStatusConfig.statusCodes[500].userMessage);
    }
  } else {
    return res.status(405).json(httpStatusConfig.statusCodes[405].userMessage);
  }
};

export default handler;
