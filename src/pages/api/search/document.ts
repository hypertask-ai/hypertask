import { httpStatusConfig } from "@/lib/configs/http-status.config";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { HTPR_6372_SEARCH_RANKING_FLAG, HTPR_6369_SEARCH_OPERATORS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { HTPR_6370_SEARCH_CHIPS_FLAG, HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG, HTPR_6865_SEARCH_LAYOUT_FLAG, HTPR_6878_SEARCH_LABEL_SCOPE_FLAG, HTPR_6881_SEARCH_FUZZY_PERSON_FLAG } from "@/lib/flags";
import { HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG } from "@/lib/flags";
import { MAX_SEARCH_OPERATOR_CLAUSES, searchOperatorClauseCount, type SearchFilter } from "@/lib/search/operators";
import { parseSearchWithChipNames, parseSearchWithNames } from "@/lib/search/serverOperators";
import { rankedSearchWhere } from "@/lib/search/rankedWhere";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
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

      const chipsEnabled = operatorsEnabled && await isFeatureEnabled(HTPR_6370_SEARCH_CHIPS_FLAG, session.userId);
      const fuzzyPersonEnabled = operatorsEnabled && await isFeatureEnabled(HTPR_6881_SEARCH_FUZZY_PERSON_FLAG, session.userId);
      const matchHighlightsEnabled = chipsEnabled &&
        await isFeatureEnabled(HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG, session.userId) &&
        await isFeatureEnabled(HTPR_6865_SEARCH_LAYOUT_FLAG, session.userId) &&
        await isFeatureEnabled(HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG, session.userId);
      const parsed = chipsEnabled
        ? await parseSearchWithChipNames(normalizedSearchQuery, requestedProjectIds, fuzzyPersonEnabled)
        : operatorsEnabled ? await parseSearchWithNames(normalizedSearchQuery, requestedProjectIds, fuzzyPersonEnabled) : null;
      if (parsed?.filters.label && chipsEnabled &&
        ![...(parsed.filters.in ?? []), ...(parsed.filters.board ?? [])].some((filter) => !filter.negated) &&
        await isFeatureEnabled(HTPR_6878_SEARCH_LABEL_SCOPE_FLAG, session.userId) &&
        await isFeatureEnabled(HTPR_6865_SEARCH_LAYOUT_FLAG, session.userId) &&
        await isFeatureEnabled(HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG, session.userId)) {
        // The picker groups trimmed names; resolve every spelling to IDs before the exact-name filter trims them.
        const labels = await prisma.label.findMany({
          where: { projectId: { in: requestedProjectIds } }, select: { id: true, value: true },
        });
        parsed.filters.label = parsed.filters.label.flatMap((filter) => {
          const matching = labels.filter((label) => label.id === filter.value ||
            label.value?.trim().toLowerCase() === filter.value.trim().toLowerCase());
          return matching.length ? matching.map((label) => ({ ...filter, value: label.id })) : [filter];
        });
      }
      if (parsed && Object.keys(parsed.filters).length) {
        const { where, rankedIds, descriptionById, commentById, partial } = await rankedSearchWhere(
          parsed, requestedProjectIds, archive === "Normal" || archive === "Archive" ? archive : null,
        );
        const matchSelect = {
          userId: true, user: { select: { displayName: true, email: true } },
          assignees: { select: { userId: true, user: { select: { displayName: true, email: true } } } },
          taskLabels: { select: { label: { select: { id: true, value: true } } } },
        } as const;
        const legacySelect = {
            id: true, projectId: true, ticketNumber: true, title: true,
            description_: { select: { content: true } }, status: true, updatedAt: true, uniqueIndex: true,
            project: { select: { title: true } },
        } as const;
        const select = { ...legacySelect, ...matchSelect };
        type SearchRow = Prisma.TaskGetPayload<{ select: typeof legacySelect }> & Partial<Prisma.TaskGetPayload<{ select: typeof matchSelect }>>;
        const primaryWhere = { ...where, id: { in: rankedIds.slice(0, 50) } };
        const primary: SearchRow[] = rankedIds.length ? await (matchHighlightsEnabled
          ? prisma.task.findMany({ where: primaryWhere, select })
          : prisma.task.findMany({ where: primaryWhere, select: legacySelect })) : [];
        const rankedPrimary = primary.toSorted((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id));
        const fallbackArgs = { where, orderBy: [{ updatedAt: 'desc' as const }, { id: 'asc' as const }], take: 50 };
        const fallback: SearchRow[] = !parsed.text ? await (matchHighlightsEnabled
          ? prisma.task.findMany({ ...fallbackArgs, select })
          : prisma.task.findMany({ ...fallbackArgs, select: legacySelect })) : [];
        const ranked = [...rankedPrimary, ...fallback].map((row) => {
          const match = matchHighlightsEnabled ? row : undefined;
          const comment = matchHighlightsEnabled ? commentById.get(row.id) : undefined;
          return {
            taskId: row.id, projectId: row.projectId, ticketNumber: row.ticketNumber,
            taskTitle: row.title, descriptionText: descriptionById.get(row.id) ?? convertToPlain(row.description_?.content ?? ''),
            projectTitle: row.project.title, status: row.status,
            updatedAt: row.updatedAt?.toISOString(), uniqueIndex: row.uniqueIndex,
            highlight: {},
            ...(matchHighlightsEnabled ? {
              searchMatch: {
                people: [...new Set([
                  ...(matchesFilter(parsed.filters.from, [match?.userId, match?.user?.displayName, match?.user?.email]) ? [match?.user?.displayName || match?.user?.email || ''] : []),
                  ...(match?.assignees ?? []).filter((person) => matchesFilter(parsed.filters.assignee, [person.userId, person.user.displayName, person.user.email]))
                    .map((person) => person.user.displayName || person.user.email || ''),
                ].filter(Boolean))],
                labels: (match?.taskLabels ?? []).filter(({ label }) => matchesFilter(parsed.filters.label, [label.id, label.value])).map(({ label }) => label.value ?? ''),
                ...(matchesFilter([...(parsed.filters.in ?? []), ...(parsed.filters.board ?? [])], [row.projectId, row.project.title]) ? { board: row.project.title ?? '' } : {}),
                ...(comment ? { commentAuthor: comment.creatorName } : {}),
              },
              ...(comment ? { commentId: Number(comment.id), commentText: comment.commentText } : {}),
            } : {}),
          };
        });
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
          ...(matchHighlightsEnabled ? { matchHighlightsEnabled: true } : {}),
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

function matchesFilter(filters: SearchFilter[] | undefined, values: (string | number | null | undefined)[]) {
  return filters?.some(({ value, negated, userIds }) => !negated && (userIds
    ? values.some((candidate) => typeof candidate === 'number' && userIds.includes(candidate))
    : values.some((candidate) => candidate != null && String(candidate).trim().toLowerCase() === value.replace(/^@/, '').trim().toLowerCase()))) ?? false;
}

export default handler;
