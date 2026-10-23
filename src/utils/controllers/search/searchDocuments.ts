import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6865_SEARCH_LAYOUT_FLAG, HTPR_6881_SEARCH_FUZZY_PERSON_FLAG } from "@/lib/flags";
import { HTPR_6368_SEARCH_OPERATOR_LOGIC_FLAG } from "@/lib/flags";
import { MAX_SEARCH_OPERATOR_CLAUSES, searchOperatorClauseCount, type SearchFilter } from "@/lib/search/operators";
import { parseSearchWithChipNames } from "@/lib/search/serverOperators";
import { rankedSearchWhere } from "@/lib/search/rankedWhere";
import { resultKinds } from "@/lib/search/filters";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { turbopufferGetDocuments } from "@/utils/controllers/search/document";
import type { SearchArchiveStatus } from "@/lib/searchArchive";
import { searchPreviewText } from "@/utils/controllers/turbopuffer/turbopufferHelper";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export type SearchDocumentsResult = { status: number; json: unknown };

export async function searchDocuments(
  userId: number,
  normalizedSearchQuery: string,
  requestedProjectIds: number[],
  archive: SearchArchiveStatus,
  contextProjectId?: number | null,
): Promise<SearchDocumentsResult> {
  if (normalizedSearchQuery.length > 200 || searchOperatorClauseCount(normalizedSearchQuery) > MAX_SEARCH_OPERATOR_CLAUSES) {
    return { status: 400, json: { message: "Search query exceeds the operator limit or 200 characters" } };
  }
  const accessibleProjects = await prisma.project.findMany({
    where: {
      id: { in: requestedProjectIds },
      status: "Normal",
      ...projectContentAccessWhere(userId),
    },
    select: { id: true },
  });
  if (accessibleProjects.length !== requestedProjectIds.length) {
    return { status: 403, json: { message: "Project access denied" } };
  }

  const fuzzyPersonEnabled = await isFeatureEnabled(HTPR_6881_SEARCH_FUZZY_PERSON_FLAG, userId);
  const matchHighlightsEnabled = await isFeatureEnabled(HTPR_6865_SEARCH_LAYOUT_FLAG, userId);
  const logicEnabled = await isFeatureEnabled(HTPR_6368_SEARCH_OPERATOR_LOGIC_FLAG, userId);
  const parsed = await parseSearchWithChipNames(normalizedSearchQuery, requestedProjectIds, fuzzyPersonEnabled, requestedProjectIds, logicEnabled);
  if (parsed.filters.label &&
    ![...(parsed.filters.in ?? []), ...(parsed.filters.board ?? [])].some((filter) => !filter.negated) &&
    await isFeatureEnabled(HTPR_6865_SEARCH_LAYOUT_FLAG, userId)) {
    const labels = await prisma.label.findMany({
      where: { projectId: { in: requestedProjectIds } }, select: { id: true, value: true },
    });
    parsed.filters.label = parsed.filters.label.flatMap((filter) => {
      const matching = labels.filter((label) => label.id === filter.value ||
        label.value?.trim().toLowerCase() === filter.value.trim().toLowerCase());
      return matching.length ? matching.map((label) => ({ ...filter, value: label.id })) : [filter];
    });
  }
  if (Object.keys(parsed.filters).length) {
    const { where, rankedIds, descriptionById, commentById, partial, commentMode } = await rankedSearchWhere(
      parsed, requestedProjectIds, archive === "Normal" || archive === "Archive" ? archive : null,
      50, {}, undefined, false,
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
    const fallback: SearchRow[] = !parsed.text && !commentMode ? await (matchHighlightsEnabled
      ? prisma.task.findMany({ ...fallbackArgs, select })
      : prisma.task.findMany({ ...fallbackArgs, select: legacySelect })) : [];
    const ranked = [...rankedPrimary, ...fallback].map((row) => {
      const match = matchHighlightsEnabled ? row : undefined;
      const comment = matchHighlightsEnabled || commentMode || (logicEnabled && resultKinds(parsed).commentOnly) ? commentById.get(row.id) : undefined;
      return {
        taskId: row.id, projectId: row.projectId, ticketNumber: row.ticketNumber,
        taskTitle: row.title, descriptionText: descriptionById.get(row.id) ?? searchPreviewText(row.description_?.content ?? ''),
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
        } : {}),
        ...(comment ? {
          commentId: Number(comment.id),
          commentText: comment.commentText,
          ...(comment.createdAt ? { updatedAt: new Date(comment.createdAt).toISOString() } : {}),
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
    return { status: ranked.length ? 200 : 204, json: {
      processedData, tabs, contextProjectId: contextProjectId ?? null,
      ...(parsed.text && partial ? { partial: true } : {}),
      status: ranked.length ? 200 : 204,
    } };
  }

  const results = await turbopufferGetDocuments(
    normalizedSearchQuery,
    requestedProjectIds,
    archive,
    {
      contextProjectId,
      applyRelevanceCut: true,
      ...(matchHighlightsEnabled ? { matchHighlightsEnabled: true } : {}),
    }
  );
  return { status: results.status, json: results };
}

function matchesFilter(filters: SearchFilter[] | undefined, values: (string | number | null | undefined)[]) {
  return filters?.some(({ value, negated, userIds }) => !negated && (userIds
    ? values.some((candidate) => typeof candidate === 'number' && userIds.includes(candidate))
    : values.some((candidate) => candidate != null && String(candidate).trim().toLowerCase() === value.replace(/^@/, '').trim().toLowerCase()))) ?? false;
}
