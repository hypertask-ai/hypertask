import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  searchComments,
  searchTasks,
  type TurbopufferCommentRow,
  type TurbopufferTaskRow,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";

type SearchStatus = "Normal" | "Archive" | "Deleted";

export interface BoardKnowledgeSearchInput {
  query: string;
  metadataFilters?: Record<string, unknown>;
  limit: number;
  projectId?: number;
  defaultProjectId?: number;
}

export interface BoardKnowledgePrincipal {
  userId: number;
  agentId?: string | null;
}

export type BoardKnowledgeDocument =
  | {
      type: "task";
      taskId: number;
      projectId: number;
      ticketNumber: string;
      title: string;
      content: string;
      updatedAt: string;
      uniqueIndex: number;
    }
  | {
      type: "comment";
      commentId: number;
      taskId: number;
      projectId: number;
      ticketNumber: string;
      title: string;
      content: string;
      createdAt: string;
      uniqueIndex: number;
    };

export type BoardKnowledgeSearchResponse =
  | {
      success: true;
      documents: BoardKnowledgeDocument[];
      total: number;
      metadata_filters?: Record<string, unknown> | null;
    }
  | {
      success: false;
      error: string;
    };

function metadataFilterValue(
  filters: Record<string, unknown> | undefined,
  keys: string[]
) {
  if (!filters) return undefined;
  for (const key of keys) {
    const raw = filters[key];
    if (raw === undefined) continue;
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      "$eq" in raw
    ) {
      return (raw as { $eq?: unknown }).$eq;
    }
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      "$in" in raw
    ) {
      const values = (raw as { $in?: unknown }).$in;
      return Array.isArray(values) ? values[0] : values;
    }
    return raw;
  }
  return undefined;
}

function numberFilterValue(
  filters: Record<string, unknown> | undefined,
  keys: string[]
) {
  const raw = metadataFilterValue(filters, keys);
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

function stringFilterValue(
  filters: Record<string, unknown> | undefined,
  keys: string[]
) {
  const raw = metadataFilterValue(filters, keys);
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function applyMetadataFilters<
  T extends TurbopufferTaskRow | TurbopufferCommentRow,
>(
  rows: T[],
  filters: Record<string, unknown> | undefined,
  kind: "task" | "comment"
) {
  const taskId = numberFilterValue(filters, ["taskId", "task_id"]);
  const ticketNumber = stringFilterValue(filters, [
    "ticketNumber",
    "ticket_number",
  ]);
  const uniqueIndex = numberFilterValue(filters, [
    "uniqueIndex",
    "unique_index",
  ]);
  const title = stringFilterValue(filters, ["title"]);

  return rows.filter((row) => {
    if (kind === "task") {
      const task = row as TurbopufferTaskRow;
      if (taskId && Number(task.id) !== taskId) return false;
      if (ticketNumber && task.ticketNumber !== ticketNumber) return false;
      if (uniqueIndex && task.uniqueIndex !== uniqueIndex) return false;
      if (title && task.title !== title) return false;
    } else {
      const comment = row as TurbopufferCommentRow;
      if (taskId && Number(comment.taskId) !== taskId) return false;
      if (ticketNumber && comment.taskTicketNumber !== ticketNumber) {
        return false;
      }
      if (uniqueIndex && comment.taskUniqueIndex !== uniqueIndex) {
        return false;
      }
      if (title && comment.taskTitle !== title) return false;
    }
    return true;
  });
}

export async function retrieveBoardKnowledge(
  input: BoardKnowledgeSearchInput,
  principal: BoardKnowledgePrincipal
): Promise<BoardKnowledgeSearchResponse> {
  const projects = await prisma.project.findMany({
    where: {
      status: "Normal",
      ...getProjectWhere(principal.userId, principal.agentId),
    },
    select: { id: true },
  });
  const accessibleProjectIds = projects.map((project) => project.id);

  if (accessibleProjectIds.length === 0) {
    return { success: true, documents: [], total: 0 };
  }

  const filterProjectId =
    input.projectId ??
    numberFilterValue(input.metadataFilters, [
      "projectId",
      "projectid",
      "project_id",
    ]) ??
    input.defaultProjectId;

  if (filterProjectId && !accessibleProjectIds.includes(filterProjectId)) {
    return { success: false, error: "Project not found or access denied" };
  }

  const status = stringFilterValue(input.metadataFilters, ["status"]) as
    | SearchStatus
    | undefined;
  const projectIds = filterProjectId
    ? [filterProjectId]
    : accessibleProjectIds;
  const [taskRowsRaw, commentRowsRaw] = await Promise.all([
    searchTasks({
      searchQuery: input.query,
      projectIds,
      status,
      projectId: filterProjectId,
      topK: Math.max(input.limit * 2, 20),
    }),
    searchComments({
      searchQuery: input.query,
      projectIds,
      status,
      topK: Math.max(input.limit * 4, 50),
      limit: Math.max(input.limit, 10),
    }),
  ]);

  const taskRows = applyMetadataFilters(
    taskRowsRaw,
    input.metadataFilters,
    "task"
  );
  const commentRows = applyMetadataFilters(
    commentRowsRaw,
    input.metadataFilters,
    "comment"
  );

  const documents: BoardKnowledgeDocument[] = [
    ...taskRows.map((row) => ({
      type: "task" as const,
      taskId: Number(row.id),
      projectId: row.projectId,
      ticketNumber: row.ticketNumber,
      title: row.title,
      content: [
        `Task: ${row.title}`,
        row.ticketNumber ? `Ticket: ${row.ticketNumber}` : "",
        row.descriptionText ? `Description: ${row.descriptionText}` : "",
        `Project: ${row.projectTitle}`,
        `Status: ${row.status}`,
      ]
        .filter(Boolean)
        .join("\n"),
      updatedAt: row.updatedAt,
      uniqueIndex: row.uniqueIndex,
    })),
    ...commentRows.map((row) => ({
      type: "comment" as const,
      commentId: Number(row.id),
      taskId: Number(row.taskId),
      projectId: row.projectId,
      ticketNumber: row.taskTicketNumber,
      title: row.taskTitle,
      content: [
        `Comment on: ${row.taskTitle}`,
        row.taskTicketNumber ? `Ticket: ${row.taskTicketNumber}` : "",
        `Comment: ${row.commentText}`,
        `Project: ${row.taskProjectTitle}`,
        `Task status: ${row.taskStatus}`,
      ]
        .filter(Boolean)
        .join("\n"),
      createdAt: row.createdAt,
      uniqueIndex: row.taskUniqueIndex,
    })),
  ].slice(0, input.limit);

  return {
    success: true,
    documents,
    total: documents.length,
    metadata_filters: input.metadataFilters ?? null,
  };
}
