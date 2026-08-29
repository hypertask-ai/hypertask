import { searchConfig } from "@/lib/configs/search.config";
import {
  searchComments,
  searchTasks,
  TurbopufferCommentRow,
  TurbopufferTaskRow,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";

type SearchStatus = "Normal" | "Archive";

type SearchHit = {
  collection: string;
  document: any;
  highlight: Record<string, { snippet: string }>;
  timestamp: number;
};

export async function turbopufferFetchMentionTasks(
  searchQuery: string,
  projectIds: number[],
  currentProjectId?: number | null
) {
  try {
    const rows = await searchTasks({
      searchQuery,
      projectIds,
      topK: 25,
      keywordOnly: true,
    });

    const orderedRows =
      currentProjectId == null
        ? activeBeforeArchived(rows)
        : [
            ...rows.filter(
              (row) =>
                row.projectId === currentProjectId && row.status !== "Archive"
            ),
            ...rows.filter(
              (row) =>
                row.projectId === currentProjectId && row.status === "Archive"
            ),
            ...rows.filter(
              (row) =>
                row.projectId !== currentProjectId && row.status !== "Archive"
            ),
            ...rows.filter(
              (row) =>
                row.projectId !== currentProjectId && row.status === "Archive"
            ),
          ];

    return orderedRows
      .slice(0, 5)
      .map((row) => ({
        id: parseInt(row.id, 10),
        name: row.title,
        type: "task",
        index: row.uniqueIndex,
        project_id: row.projectId,
        ticketNumber: row.ticketNumber,
        status: row.status,
      }));
  } catch (error) {
    console.log("turbopufferFetchMentionTasks error:", error);
    return [];
  }
}

export interface TurbopufferSearchTaskIdsOptions {
  searchQuery: string;
  projectIds: number[];
  status: SearchStatus;
  projectId?: number | null;
  perPage?: number;
}

/**
 * Search tasks in Turbopuffer and return task IDs in relevance order.
 * Used by MCP search to get full-text ranking; post-filtering
 * (section, assignee, priority, due date) is done via Prisma.
 */
export async function turbopufferSearchTaskIds(
  options: TurbopufferSearchTaskIdsOptions
): Promise<number[]> {
  const { searchQuery, projectIds, status, projectId, perPage = 50 } = options;

  try {
    const rows = await searchTasks({
      searchQuery,
      projectIds,
      status,
      projectId,
      topK: perPage,
    });

    return rows.map((row) => parseInt(row.id, 10)).filter(Number.isInteger);
  } catch (error) {
    console.error("turbopufferSearchTaskIds error:", error);
    return [];
  }
}

export async function turbopufferGetDocuments(
  searchQuery: string,
  projectIds: number[],
  archive: null | SearchStatus
) {
  try {
    const [taskRows, commentRows] = await Promise.all([
      searchTasks({
        searchQuery,
        projectIds,
        status: archive,
        topK: 50,
        keywordOnly: true,
      }),
      searchComments({
        searchQuery,
        projectIds,
        status: archive,
        topK: 200,
        limit: 50,
        keywordOnly: true,
      }),
    ]);

    if (taskRows.length === 0 && commentRows.length === 0) {
      return emptySearchResponse(204);
    }

    const taskHits = taskRows.map((row) => taskRowToHit(row, searchQuery));
    const commentHits = commentRows.map((row) =>
      commentRowToHit(row, searchQuery)
    );

    // Keep tasks over comments for the same task, preserving the search
    // relevance order (RRF rank) that Turbopuffer already returned. Do NOT
    // re-sort by recency here: with hybrid BM25 + vector search the rows arrive
    // ranked by relevance, and sorting by timestamp buried the best matches
    // under whatever was most recently updated (so "stripe" surfaced recent
    // migration tickets instead of the Stripe tasks).
    const seenTaskIds = new Set<number>();
    const deduplicatedHits: SearchHit[] = [];

    for (const hit of taskHits) {
      const taskId = parseInt(hit.document.id, 10);
      seenTaskIds.add(taskId);
      deduplicatedHits.push(hit);
    }

    for (const hit of commentHits) {
      const taskId = parseInt(hit.document.taskId, 10);
      if (!seenTaskIds.has(taskId)) {
        seenTaskIds.add(taskId);
        deduplicatedHits.push(hit);
      }
    }

    const topHits = deduplicatedHits.slice(0, 50);

    const processedData: any[] = [];

    for (const hit of topHits) {
      if (hit.collection === searchConfig.collections.task.name) {
        const data = {
          highlight: hit.highlight,
          taskId: parseInt(hit.document.id, 10),
          projectId: hit.document.projectId,
          projectTitle: hit.document.project.title,
          ticketNumber: hit.document.ticketNumber,
          taskTitle: hit.document.title,
          descriptionText: hit.document.descriptionText,
          status: hit.document.status,
          updatedAt: hit.document.updatedAt,
          uniqueIndex: hit.document.uniqueIndex,
        };
        processedData.push({ ...data });
      } else if (hit.collection === searchConfig.collections.comment.name) {
        const data = {
          highlight: hit.highlight,
          taskId: parseInt(hit.document.taskId, 10),
          commentId: parseInt(hit.document.id, 10),
          projectId: hit.document.task.projectId,
          projectTitle: hit.document.task.project.title,
          ticketNumber: hit.document.task.ticketNumber,
          taskTitle: hit.document.task.title,
          status: hit.document.task.status,
          updatedAt: hit.document.task.updatedAt,
          commentText: hit.document.commentText,
          uniqueIndex: hit.document.task.uniqueIndex,
        };
        if (archive === null) processedData.push({ ...data });
        else if (archive === hit.document.task.status)
          processedData.push({ ...data });
      }
    }

    const finalData = activeBeforeArchived(processedData);
    const resultsByProject: Record<string, any[]> = {
      All: [...finalData],
    };
    const tabs = ["All"];
    let newProjects = 0;
    let lastProject = "";

    const uniqueStatuses = new Set(
      finalData.map((item: any) => item?.status).filter(Boolean)
    );
    const hasMultipleStatuses = uniqueStatuses.size > 1;
    if (hasMultipleStatuses) {
      tabs.push("Open", "Archived");

      resultsByProject["Open"] = finalData.filter(
        (item: any) => item?.status !== "Archive"
      );

      resultsByProject["Archived"] = finalData.filter(
        (item: any) => item?.status === "Archive"
      );
    }

    for (const task of finalData) {
      const projectTitle = task.projectTitle || "Uncategorized";
      if (!tabs.includes(projectTitle)) {
        tabs.push(projectTitle);
        newProjects = newProjects + 1;
        lastProject = projectTitle;
        resultsByProject[projectTitle] = [];
      }
      resultsByProject[projectTitle].push(task);
    }

    if (newProjects < 2) {
      tabs.pop();
      delete resultsByProject[lastProject];
    }

    return {
      tabs,
      processedData: resultsByProject,
      status: 200,
    };
  } catch (error) {
    console.error("turbopufferGetDocuments error:", error);
    return emptySearchResponse(500);
  }
}

function taskRowToHit(row: TurbopufferTaskRow, searchQuery: string): SearchHit {
  return {
    collection: searchConfig.collections.task.name,
    document: {
      id: row.id,
      ticketNumber: row.ticketNumber,
      title: row.title,
      descriptionText: row.descriptionText,
      projectId: row.projectId,
      creatorName: row.creatorName,
      status: row.status,
      updatedAt: row.updatedAt,
      uniqueIndex: row.uniqueIndex,
      project: {
        title: row.projectTitle,
      },
    },
    highlight: buildHighlight(row, searchQuery, [
      "ticketNumber",
      "title",
      "descriptionText",
    ]),
    timestamp: dateValue(row.updatedAt),
  };
}

function commentRowToHit(
  row: TurbopufferCommentRow,
  searchQuery: string
): SearchHit {
  return {
    collection: searchConfig.collections.comment.name,
    document: {
      id: row.id,
      taskId: row.taskId,
      commentText: row.commentText,
      creatorName: row.creatorName,
      projectId: row.projectId,
      createdAt: row.createdAt,
      task: {
        id: parseInt(row.taskId, 10),
        projectId: row.taskProjectId,
        ticketNumber: row.taskTicketNumber,
        title: row.taskTitle,
        status: row.taskStatus,
        updatedAt: row.taskUpdatedAt,
        uniqueIndex: row.taskUniqueIndex,
        project: {
          title: row.taskProjectTitle,
        },
      },
    },
    highlight: buildHighlight(row, searchQuery, ["commentText"]),
    timestamp: dateValue(row.createdAt),
  };
}

function buildHighlight(
  row: Record<string, unknown>,
  searchQuery: string,
  fields: string[]
) {
  const highlight: Record<string, { snippet: string }> = {};

  for (const field of fields) {
    const snippet = highlightedSnippet(String(row[field] ?? ""), searchQuery);
    if (snippet) highlight[field] = { snippet };
  }

  return highlight;
}

function highlightedSnippet(value: string, searchQuery: string) {
  const terms = getQueryTerms(searchQuery);
  if (!value || terms.length === 0) return null;

  const lowerValue = value.toLowerCase();
  const firstMatch = terms
    .map((term) => lowerValue.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (firstMatch === undefined) return null;

  const start = Math.max(0, firstMatch - 60);
  const end = Math.min(value.length, firstMatch + 160);
  const rawSnippet = `${start > 0 ? "..." : ""}${value.slice(start, end)}${
    end < value.length ? "..." : ""
  }`;
  const escapedSnippet = escapeHtml(rawSnippet);
  const regex = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");

  return escapedSnippet.replace(regex, "<mark>$1</mark>");
}

function getQueryTerms(searchQuery: string) {
  return Array.from(
    new Set(searchQuery.match(/[a-zA-Z0-9_-]+/g)?.filter(Boolean) ?? [])
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateValue(value: string) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function activeBeforeArchived<T extends { status?: string | null }>(items: T[]) {
  return [
    ...items.filter((item) => item?.status !== "Archive"),
    ...items.filter((item) => item?.status === "Archive"),
  ];
}

function emptySearchResponse(status: 204 | 500) {
  return {
    processedData: {
      All: {
        All: [],
      },
    },
    tabs: ["All"],
    status,
  };
}
