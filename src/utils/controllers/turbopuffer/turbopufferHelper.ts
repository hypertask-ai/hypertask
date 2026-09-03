import { Prisma } from "@prisma/client";
import { createHash } from "crypto";

import prisma from "@/lib/prisma";
import turbopuffer, { turbopufferNamespaces } from "@/lib/turbopuffer";
import { buildCustomInstructionSearchFilters } from "@/app/api/ai/_lib/boardMemoryContract";

type SearchStatus = "Normal" | "Archive" | "Deleted";

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDINGS_ENDPOINT = "https://ai-gateway.vercel.sh/v1/embeddings";
export const EMBEDDING_DIM = 1536;

const EMBEDDING_BATCH_SIZE = 256;
const EMBEDDING_MAX_RETRIES = 5;
const CUSTOM_INSTRUCTION_CHUNK_SIZE = 1800;
const CUSTOM_INSTRUCTION_CHUNK_OVERLAP = 200;
const CUSTOM_INSTRUCTION_MAX_CHUNKS = 50;

type OpenAIEmbeddingResponse = {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
};

export const turbopufferTaskInclude = {
  user: true,
  description_: true,
  project: {
    select: {
      title: true,
    },
  },
} satisfies Prisma.TaskInclude;

export const turbopufferCommentInclude = {
  creator: true,
  agent: { select: { displayName: true } },
  task: {
    select: {
      id: true,
      projectId: true,
      ticketNumber: true,
      title: true,
      status: true,
      updatedAt: true,
      uniqueIndex: true,
      project: {
        select: {
          title: true,
        },
      },
    },
  },
} satisfies Prisma.CommentInclude;

export const turbopufferPageInclude = {
  task: {
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      project: {
        select: {
          title: true,
        },
      },
    },
  },
} satisfies Prisma.PageInclude;

export type TaskForTurbopuffer = Prisma.TaskGetPayload<{
  include: typeof turbopufferTaskInclude;
}>;

export type CommentForTurbopuffer = Prisma.CommentGetPayload<{
  include: typeof turbopufferCommentInclude;
}>;

export type PageForTurbopuffer = Prisma.PageGetPayload<{
  include: typeof turbopufferPageInclude;
}>;

export type TurbopufferTaskRow = {
  id: string;
  ticketNumber: string;
  title: string;
  descriptionText: string;
  projectId: number;
  creatorName: string;
  status: string;
  updatedAt: string;
  searchText: string;
  uniqueIndex: number;
  projectTitle: string;
  $dist?: number;
};

export type TurbopufferCommentRow = {
  id: string;
  taskId: string;
  commentText: string;
  creatorName: string;
  projectId: number;
  createdAt: string;
  searchText: string;
  taskProjectId: number;
  taskProjectTitle: string;
  taskTicketNumber: string;
  taskTitle: string;
  taskStatus: string;
  taskUpdatedAt: string;
  taskUniqueIndex: number;
  $dist?: number;
};

export type TurbopufferPageRow = {
  id: string;
  title: string;
  contentText: string;
  taskId: string;
  projectId: number;
  projectTitle: string;
  taskTicketNumber: string;
  taskTitle: string;
  updatedAt: string;
  searchText: string;
};

export type TurbopufferCustomInstructionFileRow = {
  id: string;
  projectId: number;
  teamId: string;
  source: string;
  fileName: string;
  fileType: string;
  content: string;
  searchText: string;
  chunkIndex: number;
  updatedAt: string;
  $dist?: number;
};

type TurbopufferVectorRow<T> = T & {
  vector?: number[];
};

type TicketSearchQuery = {
  prefix: string | null;
  uniqueIndex: number;
  normalizedQuery: string;
};

export const taskNamespaceSchema = {
  ticketNumber: { type: "string", full_text_search: true },
  title: { type: "string", full_text_search: true },
  descriptionText: { type: "string", full_text_search: true },
  searchText: { type: "string", full_text_search: true },
  projectId: { type: "int", filterable: true },
  creatorName: { type: "string", filterable: true },
  status: { type: "string", filterable: true },
  updatedAt: { type: "string" },
  uniqueIndex: { type: "int" },
  projectTitle: { type: "string" },
};

export const commentNamespaceSchema = {
  taskId: { type: "string", filterable: true },
  commentText: { type: "string", full_text_search: true },
  searchText: { type: "string", full_text_search: true },
  creatorName: { type: "string", filterable: true },
  projectId: { type: "int", filterable: true },
  createdAt: { type: "string" },
  taskProjectId: { type: "int", filterable: true },
  taskProjectTitle: { type: "string" },
  taskTicketNumber: { type: "string" },
  taskTitle: { type: "string" },
  taskStatus: { type: "string", filterable: true },
  taskUpdatedAt: { type: "string" },
  taskUniqueIndex: { type: "int" },
};

export const pageNamespaceSchema = {
  title: { type: "string", full_text_search: true },
  contentText: { type: "string", full_text_search: true },
  taskId: { type: "string", filterable: true },
  projectId: { type: "int", filterable: true },
  projectTitle: { type: "string" },
  taskTicketNumber: { type: "string" },
  taskTitle: { type: "string" },
  updatedAt: { type: "string" },
  searchText: { type: "string", full_text_search: true },
};

export const customInstructionFileNamespaceSchema = {
  projectId: { type: "int", filterable: true },
  teamId: { type: "string", filterable: true },
  source: { type: "string", filterable: true },
  fileName: { type: "string", full_text_search: true },
  fileType: { type: "string", filterable: true },
  content: { type: "string", full_text_search: true },
  searchText: { type: "string", full_text_search: true },
  chunkIndex: { type: "int" },
  updatedAt: { type: "string" },
};

export const TASK_INCLUDE_ATTRIBUTES = [
  "ticketNumber",
  "title",
  "descriptionText",
  "projectId",
  "creatorName",
  "status",
  "updatedAt",
  "uniqueIndex",
  "projectTitle",
];

export const COMMENT_INCLUDE_ATTRIBUTES = [
  "taskId",
  "commentText",
  "creatorName",
  "projectId",
  "createdAt",
  "taskProjectId",
  "taskProjectTitle",
  "taskTicketNumber",
  "taskTitle",
  "taskStatus",
  "taskUpdatedAt",
  "taskUniqueIndex",
];

export const CUSTOM_INSTRUCTION_FILE_INCLUDE_ATTRIBUTES = [
  "projectId",
  "teamId",
  "source",
  "fileName",
  "fileType",
  "content",
  "chunkIndex",
  "updatedAt",
];
const DEFAULT_CUSTOM_INSTRUCTION_FILE_LIST_LIMIT = 100;

type SearchTasksParams = {
  searchQuery: string;
  projectIds: number[];
  status?: SearchStatus | null;
  projectId?: number | null;
  topK?: number;
  // Skip the embedding call and run keyword-only (BM25). The embedding is a
  // ~700ms network round-trip, so latency-sensitive typeaheads (the search box,
  // @mentions) pass this to stay instant for exact title-style lookups. Hybrid
  // vector search stays on for latency-tolerant callers (MCP/AI).
  keywordOnly?: boolean;
};

type SearchCommentsParams = {
  searchQuery: string;
  projectIds: number[];
  status?: SearchStatus | null;
  topK?: number;
  limit?: number;
  keywordOnly?: boolean;
};

type SearchCustomInstructionFilesParams = {
  searchQuery: string;
  projectId: number;
  topK?: number;
  keywordOnly?: boolean;
  includeBoardMemory?: boolean;
};

const buildTaskBm25RankBy = (query: string) => [
  "Sum",
  [
    ["Product", [4, ["title", "BM25", query, { last_as_prefix: true }]]],
    [
      "Product",
      [2, ["ticketNumber", "BM25", query, { last_as_prefix: true }]],
    ],
    ["searchText", "BM25", query, { last_as_prefix: true }],
  ],
];

const buildCommentBm25RankBy = (query: string) => [
  "Sum",
  [
    [
      "Product",
      [2, ["commentText", "BM25", query, { last_as_prefix: true }]],
    ],
    ["searchText", "BM25", query, { last_as_prefix: true }],
  ],
];

function parseTicketSearchQuery(query: string): TicketSearchQuery | null {
  const prefixedMatch = query.match(/^([A-Za-z]{2,10})[-\s]?(\d{1,7})$/);
  if (prefixedMatch) {
    const prefix = prefixedMatch[1].toUpperCase();
    const uniqueIndex = Number(prefixedMatch[2]);

    return {
      prefix,
      uniqueIndex,
      normalizedQuery: `${prefix}-${uniqueIndex}`,
    };
  }

  const bareMatch = query.match(/^(\d{1,7})$/);
  if (bareMatch) {
    return {
      prefix: null,
      uniqueIndex: Number(bareMatch[1]),
      normalizedQuery: query,
    };
  }

  return null;
}

export function buildTurbopufferTaskRow(
  task: TaskForTurbopuffer
): TurbopufferTaskRow {
  const ticketNumber = stringify(task.ticketNumber);
  const title = stringify(task.title);
  const descriptionText = convertToPlain(task.description_?.content ?? "");

  return {
    id: task.id.toString(),
    ticketNumber,
    title,
    descriptionText,
    projectId: task.projectId,
    creatorName: stringify(task.user?.displayName),
    status: stringify(task.status),
    updatedAt: toIsoString(task.updatedAt),
    searchText: buildSearchText(ticketNumber, title, descriptionText),
    uniqueIndex: task.uniqueIndex,
    projectTitle: stringify(task.project?.title),
  };
}

export function buildTurbopufferCommentRow(
  comment: CommentForTurbopuffer
): TurbopufferCommentRow | null {
  if (comment.activity) return null;

  const commentText = convertToPlain(comment.text ?? "");
  const task = comment.task;

  return {
    id: comment.id.toString(),
    taskId: comment.taskId.toString(),
    commentText,
    creatorName: stringify(
      comment.agent?.displayName ??
        comment.agentDisplayName ??
        comment.creator?.displayName
    ),
    projectId: task.projectId,
    createdAt: toIsoString(comment.createdAt),
    searchText: commentText,
    taskProjectId: task.projectId,
    taskProjectTitle: stringify(task.project?.title),
    taskTicketNumber: stringify(task.ticketNumber),
    taskTitle: stringify(task.title),
    taskStatus: stringify(task.status),
    taskUpdatedAt: toIsoString(task.updatedAt),
    taskUniqueIndex: task.uniqueIndex,
  };
}

export function buildTurbopufferPageRow(
  page: PageForTurbopuffer
): TurbopufferPageRow {
  const title = stringify(page.title);
  const contentText = stringify(page.contentText);

  return {
    id: page.id.toString(),
    title,
    contentText,
    taskId: page.taskId.toString(),
    projectId: page.projectId,
    projectTitle: stringify(page.task.project?.title),
    taskTicketNumber: stringify(page.task.ticketNumber),
    taskTitle: stringify(page.task.title),
    updatedAt: toIsoString(page.updatedAt),
    searchText: buildSearchText(title, contentText),
  };
}

export function buildCustomInstructionFileRows(args: {
  projectId: number;
  teamId: string;
  source: string;
  fileName: string;
  fileType: string;
  content: string;
}): TurbopufferCustomInstructionFileRow[] {
  const normalizedContent =
    normalizeWhitespace(convertToPlain(args.content)) ||
    normalizeWhitespace(`${args.fileName} ${args.source}`);
  const chunks = chunkText(
    normalizedContent,
    CUSTOM_INSTRUCTION_CHUNK_SIZE,
    CUSTOM_INSTRUCTION_CHUNK_OVERLAP
  ).slice(0, CUSTOM_INSTRUCTION_MAX_CHUNKS);
  const updatedAt = new Date().toISOString();

  return chunks.map((content, chunkIndex) => ({
    id: customInstructionFileRowId(args.projectId, args.source, chunkIndex),
    projectId: args.projectId,
    teamId: stringify(args.teamId),
    source: args.source,
    fileName: args.fileName,
    fileType: args.fileType,
    content,
    searchText: buildSearchText(args.fileName, args.fileType, content),
    chunkIndex,
    updatedAt,
  }));
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
  if (!apiKey) {
    throw new Error("TURBOPUFFER_EMBEDDINGS_API_KEY is not set");
  }

  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    embeddings.push(...(await embedBatchWithRetry(batch, apiKey)));
  }

  return embeddings;
}

// Embed a single batch, retrying transient failures (rate limits, server
// errors, network blips) with exponential backoff. A whole failed batch was
// crashing the backfill because the caller would then upsert vector-less rows
// into a cosine namespace, which Turbopuffer rejects.
async function embedBatchWithRetry(
  batch: string[],
  apiKey: string
): Promise<number[][]> {
  let lastError: unknown;

  for (let attempt = 0; attempt < EMBEDDING_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, 500 * 2 ** (attempt - 1))
      );
    }

    let response: Response;
    try {
      response = await fetch(EMBEDDINGS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: batch,
        }),
      });
    } catch (networkError) {
      lastError = networkError;
      continue;
    }

    if (!response.ok) {
      const responseText = await response
        .text()
        .catch(() => response.statusText);
      const error = new Error(
        `OpenAI embeddings request failed (${response.status}): ${responseText}`
      );
      // Retry rate limits and server errors; fail fast on other client errors.
      if (response.status === 429 || response.status >= 500) {
        lastError = error;
        continue;
      }
      throw error;
    }

    const json = (await response.json()) as OpenAIEmbeddingResponse;
    const batchEmbeddings = json.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);

    if (batchEmbeddings.length !== batch.length) {
      throw new Error(
        `OpenAI embeddings returned ${batchEmbeddings.length} embeddings for ${batch.length} inputs`
      );
    }

    const invalidEmbedding = batchEmbeddings.find(
      (embedding) => embedding.length !== EMBEDDING_DIM
    );
    if (invalidEmbedding) {
      throw new Error(
        `OpenAI embeddings returned ${invalidEmbedding.length} dimensions; expected ${EMBEDDING_DIM}`
      );
    }

    return batchEmbeddings;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenAI embeddings request failed after retries");
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  if (!embedding) {
    throw new Error("OpenAI embeddings returned no embedding");
  }
  return embedding;
}

export async function upsertTaskToTurbopuffer(taskId: number) {
  try {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
      },
      include: turbopufferTaskInclude,
    });

    if (!task) return;
    return upsertTaskRowsToTurbopuffer([buildTurbopufferTaskRow(task)]);
  } catch (error) {
    console.log("turbopuffer upsertTaskToTurbopuffer error:", error);
  }
}

export async function upsertTaskRowsToTurbopuffer(
  rows: TurbopufferTaskRow[],
  options: { disableBackpressure?: boolean } = {}
) {
  if (rows.length === 0) return;

  const { rows: rowsWithVectors, hasVectors } = await embedRowsForWrite(
    rows,
    "turbopuffer task upsert"
  );

  // The namespace is cosine (vector-required); a vector-less write is rejected.
  // If embeddings are unavailable, skip rather than crash — the row can be
  // reindexed later. Backfill logs surface any gap.
  if (!hasVectors) {
    console.error(
      `turbopuffer task upsert skipped: embeddings unavailable for ${rows.length} row(s)`
    );
    return;
  }

  return turbopuffer.namespace(turbopufferNamespaces.task.name).write({
    upsert_rows: rowsWithVectors,
    distance_metric: "cosine_distance",
    schema: taskNamespaceSchema,
    ...(options.disableBackpressure ? { disable_backpressure: true } : {}),
  } as any);
}

export async function deleteTaskInTurbopuffer(taskId: number) {
  try {
    const result = await deleteDocsInTurbopuffer(
      turbopufferNamespaces.task.name,
      [taskId]
    );
    console.log("turbopuffer deleteTaskInTurbopuffer result:", result);
    return result;
  } catch (error) {
    console.log("turbopuffer deleteTaskInTurbopuffer error:", error);
  }
}

export async function upsertCommentToTurbopuffer(commentId: number) {
  try {
    const comment = await prisma.comment.findFirst({
      where: {
        id: commentId,
      },
      include: turbopufferCommentInclude,
    });

    if (!comment) return;

    const row = buildTurbopufferCommentRow(comment);
    if (!row) return;

    return upsertCommentRowsToTurbopuffer([row]);
  } catch (error) {
    console.log("turbopuffer upsertCommentToTurbopuffer error:", error);
  }
}

export async function upsertCommentRowsToTurbopuffer(
  rows: TurbopufferCommentRow[],
  options: { disableBackpressure?: boolean } = {}
) {
  if (rows.length === 0) return;

  const { rows: rowsWithVectors, hasVectors } = await embedRowsForWrite(
    rows,
    "turbopuffer comment upsert"
  );

  // The namespace is cosine (vector-required); a vector-less write is rejected.
  // If embeddings are unavailable, skip rather than crash — the row can be
  // reindexed later. Backfill logs surface any gap.
  if (!hasVectors) {
    console.error(
      `turbopuffer comment upsert skipped: embeddings unavailable for ${rows.length} row(s)`
    );
    return;
  }

  return turbopuffer.namespace(turbopufferNamespaces.comment.name).write({
    upsert_rows: rowsWithVectors,
    distance_metric: "cosine_distance",
    schema: commentNamespaceSchema,
    ...(options.disableBackpressure ? { disable_backpressure: true } : {}),
  } as any);
}

export async function upsertPageToTurbopuffer(pageId: number) {
  try {
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        archived: false,
      },
      include: turbopufferPageInclude,
    });

    if (!page) return;
    return upsertPageRowsToTurbopuffer([buildTurbopufferPageRow(page)]);
  } catch (error) {
    console.log("turbopuffer upsertPageToTurbopuffer error:", error);
  }
}

export async function upsertPageRowsToTurbopuffer(
  rows: TurbopufferPageRow[],
  options: { disableBackpressure?: boolean } = {}
) {
  if (rows.length === 0) return;

  const { rows: rowsWithVectors, hasVectors } = await embedRowsForWrite(
    rows,
    "turbopuffer page upsert"
  );

  if (!hasVectors) {
    console.error(
      `turbopuffer page upsert skipped: embeddings unavailable for ${rows.length} row(s)`
    );
    return;
  }

  return turbopuffer.namespace(turbopufferNamespaces.page.name).write({
    upsert_rows: rowsWithVectors,
    distance_metric: "cosine_distance",
    schema: pageNamespaceSchema,
    ...(options.disableBackpressure ? { disable_backpressure: true } : {}),
  } as any);
}

// Runs every time a task is archived/unarchived or task metadata changes.
export async function upsertAllCommentsToTurbopuffer(taskId: number) {
  try {
    const allComments = await prisma.comment.findMany({
      where: { taskId },
      include: turbopufferCommentInclude,
    });

    const commentRows = allComments
      .map(buildTurbopufferCommentRow)
      .filter((row): row is TurbopufferCommentRow => row !== null);

    if (commentRows.length === 0) return;
    return upsertCommentRowsToTurbopuffer(commentRows);
  } catch (error) {
    console.log("turbopuffer upsertAllCommentsToTurbopuffer error:", error);
  }
}

// Runs every time a task is permanently deleted.
export async function deleteManyCommentsInTurbopuffer(taskId: number) {
  try {
    const allComments = await prisma.comment.findMany({
      where: { taskId },
      select: {
        id: true,
        activity: true,
      },
    });

    const commentIds = allComments
      .filter((comment) => !comment.activity)
      .map((comment) => comment.id);

    const result = await deleteDocsInTurbopuffer(
      turbopufferNamespaces.comment.name,
      commentIds
    );
    console.log("turbopuffer deleteManyCommentsInTurbopuffer result:", result);
    return result;
  } catch (error) {
    console.error("turbopuffer deleteManyCommentsInTurbopuffer error:", error);
  }
}

export async function deleteCommentInTurbopuffer(commentId: number) {
  try {
    const result = await deleteDocsInTurbopuffer(
      turbopufferNamespaces.comment.name,
      [commentId]
    );
    console.log("turbopuffer deleteCommentInTurbopuffer result:", result);
    return result;
  } catch (error) {
    console.log("turbopuffer deleteCommentInTurbopuffer error:", error);
  }
}

export async function deletePageFromTurbopuffer(pageId: number) {
  try {
    const result = await deleteDocsInTurbopuffer(
      turbopufferNamespaces.page.name,
      [pageId]
    );
    console.log("turbopuffer deletePageFromTurbopuffer result:", result);
    return result;
  } catch (error) {
    console.log("turbopuffer deletePageFromTurbopuffer error:", error);
  }
}

export async function deleteDocsInTurbopuffer(
  namespace: string,
  ids: Array<number | string>
) {
  const deletes = ids.map((id) => id.toString());
  if (deletes.length === 0) return;

  return turbopuffer.namespace(namespace).write({
    deletes,
  });
}

export async function upsertCustomInstructionFileRowsToTurbopuffer(
  rows: TurbopufferCustomInstructionFileRow[],
  options: {
    beforeWrite?: () => Promise<void>;
    disableBackpressure?: boolean;
  } = {}
) {
  if (rows.length === 0) return;

  const { rows: rowsWithVectors, hasVectors } = await embedRowsForWrite(
    rows,
    "turbopuffer custom instruction file upsert"
  );

  if (!hasVectors) {
    console.error(
      `turbopuffer custom instruction file upsert skipped: embeddings unavailable for ${rows.length} row(s)`
    );
    return;
  }

  await options.beforeWrite?.();

  return turbopuffer
    .namespace(turbopufferNamespaces.customInstructionFile.name)
    .write({
      upsert_rows: rowsWithVectors,
      distance_metric: "cosine_distance",
      schema: customInstructionFileNamespaceSchema,
      ...(options.disableBackpressure ? { disable_backpressure: true } : {}),
    } as any);
}

export async function deleteCustomInstructionFileInTurbopuffer(args: {
  projectId: number;
  source: string;
}) {
  const deletes = Array.from(
    { length: CUSTOM_INSTRUCTION_MAX_CHUNKS },
    (_, chunkIndex) =>
      customInstructionFileRowId(args.projectId, args.source, chunkIndex)
  );

  return deleteDocsInTurbopuffer(
    turbopufferNamespaces.customInstructionFile.name,
    deletes
  );
}

export async function searchTasks({
  searchQuery,
  projectIds,
  status,
  projectId,
  topK = 50,
  keywordOnly = false,
}: SearchTasksParams): Promise<TurbopufferTaskRow[]> {
  const query = searchQuery.trim();
  const projectFilter = buildProjectFilter(projectIds, projectId);
  if (!query || !projectFilter) return [];

  const ticketQuery = parseTicketSearchQuery(query);
  const rankQuery = ticketQuery?.normalizedQuery ?? query;
  const filters = combineFilters([
    projectFilter,
    status ? ["status", "Eq", status] : null,
  ]);
  const exactRowsPromise = searchExactTaskRowsByTicket(
    ticketQuery,
    projectFilter,
    status
  );

  const queryVector = keywordOnly
    ? null
    : await embedQueryForSearch(rankQuery, "turbopuffer searchTasks");

  if (queryVector) {
    try {
      const [exactRows, response] = await Promise.all([
        exactRowsPromise,
        turbopuffer
          .namespace(turbopufferNamespaces.task.name)
          .query({
            // include_attributes must live INSIDE each sub-query: with RRF
            // multi-query, a top-level include_attributes is ignored and the
            // fused rows come back with only ids, so every attribute is
            // undefined and the results get filtered out downstream.
            queries: [
              {
                rank_by: ["vector", "ANN", queryVector],
                top_k: topK,
                filters,
                include_attributes: TASK_INCLUDE_ATTRIBUTES,
              },
              {
                rank_by: buildTaskBm25RankBy(rankQuery),
                top_k: topK,
                filters,
                include_attributes: TASK_INCLUDE_ATTRIBUTES,
              },
            ],
            rerank_by: ["RRF"],
          } as any),
      ]);

      const searchRows = getMultiQueryRows<TurbopufferTaskRow>(response).map(
        normalizeTaskRow
      );
      return pinExactTaskRows(exactRows, searchRows, topK);
    } catch (error) {
      console.error(
        "turbopuffer searchTasks hybrid error, falling back to BM25:",
        error
      );
    }
  }

  try {
    const [exactRows, searchRows] = await Promise.all([
      exactRowsPromise,
      searchTaskRowsWithBm25(rankQuery, topK, filters),
    ]);
    return pinExactTaskRows(exactRows, searchRows, topK);
  } catch (error) {
    console.error("turbopuffer searchTasks error:", error);
    return [];
  }
}

export async function searchComments({
  searchQuery,
  projectIds,
  status,
  topK = 200,
  limit = 50,
  keywordOnly = false,
}: SearchCommentsParams): Promise<TurbopufferCommentRow[]> {
  const query = searchQuery.trim();
  const projectFilter = buildProjectFilter(projectIds);
  if (!query || !projectFilter) return [];

  const filters = combineFilters([
    projectFilter,
    status ? ["taskStatus", "Eq", status] : null,
  ]);

  const queryVector = keywordOnly
    ? null
    : await embedQueryForSearch(query, "turbopuffer searchComments");

  if (queryVector) {
    try {
      const response = await turbopuffer
        .namespace(turbopufferNamespaces.comment.name)
        .query({
          // include_attributes must live INSIDE each sub-query (see searchTasks).
          queries: [
            {
              rank_by: ["vector", "ANN", queryVector],
              top_k: topK,
              filters,
              include_attributes: COMMENT_INCLUDE_ATTRIBUTES,
            },
            {
              rank_by: buildCommentBm25RankBy(query),
              top_k: topK,
              filters,
              include_attributes: COMMENT_INCLUDE_ATTRIBUTES,
            },
          ],
          rerank_by: ["RRF"],
        } as any);

      return normalizeAndGroupCommentRows(
        getMultiQueryRows<TurbopufferCommentRow>(response),
        limit
      );
    } catch (error) {
      console.error(
        "turbopuffer searchComments hybrid error, falling back to BM25:",
        error
      );
    }
  }

  try {
    return await searchCommentRowsWithBm25(query, topK, filters, limit);
  } catch (error) {
    console.error("turbopuffer searchComments error:", error);
    return [];
  }
}

export async function searchCustomInstructionFiles({
  searchQuery,
  projectId,
  topK = 10,
  keywordOnly = false,
  includeBoardMemory = false,
}: SearchCustomInstructionFilesParams): Promise<
  TurbopufferCustomInstructionFileRow[]
> {
  const query = searchQuery.trim();
  if (!query || !Number.isInteger(projectId)) return [];

  const filters = buildCustomInstructionSearchFilters(
    projectId,
    includeBoardMemory
  );
  const queryVector = keywordOnly
    ? null
    : await embedQueryForSearch(query, "turbopuffer searchCustomInstructionFiles");

  if (queryVector) {
    try {
      const response = await turbopuffer
        .namespace(turbopufferNamespaces.customInstructionFile.name)
        .query({
          queries: [
            {
              rank_by: ["vector", "ANN", queryVector],
              top_k: topK,
              filters,
              include_attributes: CUSTOM_INSTRUCTION_FILE_INCLUDE_ATTRIBUTES,
            },
            {
              rank_by: [
                "searchText",
                "BM25",
                query,
                { last_as_prefix: true },
              ],
              top_k: topK,
              filters,
              include_attributes: CUSTOM_INSTRUCTION_FILE_INCLUDE_ATTRIBUTES,
            },
          ],
          rerank_by: ["RRF"],
        } as any);

      return getMultiQueryRows<TurbopufferCustomInstructionFileRow>(response).map(
        normalizeCustomInstructionFileRow
      );
    } catch (error) {
      console.error(
        "turbopuffer searchCustomInstructionFiles hybrid error, falling back to BM25:",
        error
      );
    }
  }

  try {
    const response = await turbopuffer
      .namespace(turbopufferNamespaces.customInstructionFile.name)
      .query({
        rank_by: ["searchText", "BM25", query, { last_as_prefix: true }],
        top_k: topK,
        filters,
        include_attributes: CUSTOM_INSTRUCTION_FILE_INCLUDE_ATTRIBUTES,
      } as any);

    return (
      (response.rows ?? []) as unknown as TurbopufferCustomInstructionFileRow[]
    ).map(normalizeCustomInstructionFileRow);
  } catch (error) {
    console.error("turbopuffer searchCustomInstructionFiles error:", error);
    return [];
  }
}

export async function listCustomInstructionFileRows(args: {
  projectId: number;
  fileType: string;
  topK?: number;
}) {
  if (!Number.isInteger(args.projectId) || !args.fileType) return [];

  try {
    const response = await turbopuffer
      .namespace(turbopufferNamespaces.customInstructionFile.name)
      .query({
        rank_by: ["updatedAt", "desc"],
        top_k: args.topK ?? DEFAULT_CUSTOM_INSTRUCTION_FILE_LIST_LIMIT,
        filters: [
          "And",
          [
            ["projectId", "Eq", args.projectId],
            ["fileType", "Eq", args.fileType],
          ],
        ],
        include_attributes: CUSTOM_INSTRUCTION_FILE_INCLUDE_ATTRIBUTES,
      });

    return (
      (response.rows ?? []) as unknown as TurbopufferCustomInstructionFileRow[]
    ).map(normalizeCustomInstructionFileRow);
  } catch (error) {
    console.error("turbopuffer listCustomInstructionFileRows error:", error);
    throw error;
  }
}

export async function ensureTurbopufferSchema() {
  await Promise.all([
    ensureNamespaceSchema(
      turbopufferNamespaces.task.name,
      taskNamespaceSchema,
      {
        id: "__schema__",
        ticketNumber: "",
        title: "",
        descriptionText: "",
        projectId: -1,
        creatorName: "",
        status: "__schema__",
        updatedAt: "",
        searchText: "",
        uniqueIndex: -1,
        projectTitle: "",
      }
    ),
    ensureNamespaceSchema(
      turbopufferNamespaces.comment.name,
      commentNamespaceSchema,
      {
        id: "__schema__",
        taskId: "-1",
        commentText: "",
        creatorName: "",
        projectId: -1,
        createdAt: "",
        searchText: "",
        taskProjectId: -1,
        taskProjectTitle: "",
        taskTicketNumber: "",
        taskTitle: "",
        taskStatus: "__schema__",
        taskUpdatedAt: "",
        taskUniqueIndex: -1,
      }
    ),
    ensureNamespaceSchema(
      turbopufferNamespaces.page.name,
      pageNamespaceSchema,
      {
        id: "__schema__",
        title: "",
        contentText: "",
        taskId: "-1",
        projectId: -1,
        projectTitle: "",
        taskTicketNumber: "",
        taskTitle: "",
        updatedAt: "",
        searchText: "",
      }
    ),
    ensureNamespaceSchema(
      turbopufferNamespaces.customInstructionFile.name,
      customInstructionFileNamespaceSchema,
      {
        id: "__schema__",
        projectId: -1,
        teamId: "__schema__",
        source: "__schema__",
        fileName: "",
        fileType: "__schema__",
        content: "",
        searchText: "",
        chunkIndex: -1,
        updatedAt: "",
      }
    ),
  ]);
}

async function ensureNamespaceSchema(
  namespace: string,
  schema: Record<string, unknown>,
  schemaRow: Record<string, unknown> & { id: string }
) {
  const ns = turbopuffer.namespace(namespace);
  // Seed a real vector so the namespace is created with the cosine metric that
  // live upserts use. Without a vector + distance_metric the namespace defaults
  // to euclidean, and later cosine writes fail with a metric mismatch.
  const seedVector = new Array(EMBEDDING_DIM).fill(0);
  seedVector[0] = 1;
  await ns.write({
    upsert_rows: [{ ...schemaRow, vector: seedVector }],
    distance_metric: "cosine_distance",
    schema,
  } as any);
  await ns.write({
    deletes: [schemaRow.id],
  });
}

async function embedRowsForWrite<T extends { searchText: string }>(
  rows: T[],
  context: string
): Promise<{ rows: Array<TurbopufferVectorRow<T>>; hasVectors: boolean }> {
  try {
    const embeddings = await embedTexts(rows.map((row) => row.searchText));
    return {
      rows: rows.map((row, index) => ({
        ...row,
        vector: embeddings[index],
      })),
      hasVectors: true,
    };
  } catch (error) {
    console.error(
      `${context} embedding error, upserting without vectors:`,
      error
    );
    return { rows, hasVectors: false };
  }
}

async function embedQueryForSearch(
  query: string,
  context: string
): Promise<number[] | null> {
  try {
    return await embedText(query);
  } catch (error) {
    console.error(`${context} embedding error, using BM25 only:`, error);
    return null;
  }
}

async function searchTaskRowsWithBm25(
  query: string,
  topK: number,
  filters: unknown[] | undefined
): Promise<TurbopufferTaskRow[]> {
  const response = await turbopuffer
    .namespace(turbopufferNamespaces.task.name)
    .query({
      rank_by: buildTaskBm25RankBy(query),
      top_k: topK,
      filters,
      include_attributes: TASK_INCLUDE_ATTRIBUTES,
    } as any);

  return ((response.rows ?? []) as unknown as TurbopufferTaskRow[]).map(
    normalizeTaskRow
  );
}

async function searchExactTaskRowsByTicket(
  ticketQuery: TicketSearchQuery | null,
  projectFilter: unknown[],
  status?: SearchStatus | null
): Promise<TurbopufferTaskRow[]> {
  if (!ticketQuery) return [];

  try {
    const response = await turbopuffer
      .namespace(turbopufferNamespaces.task.name)
      .query({
        filters: combineFilters([
          projectFilter,
          status ? ["status", "Eq", status] : null,
          ["uniqueIndex", "Eq", ticketQuery.uniqueIndex],
        ]),
        include_attributes: TASK_INCLUDE_ATTRIBUTES,
        top_k: 20,
      } as any);

    const rows = ((response.rows ?? []) as unknown as TurbopufferTaskRow[]).map(
      normalizeTaskRow
    );

    if (!ticketQuery.prefix) return rows;

    const dashedTicketNumber =
      `${ticketQuery.prefix}-${ticketQuery.uniqueIndex}`.toLowerCase();
    const compactTicketNumber =
      `${ticketQuery.prefix}${ticketQuery.uniqueIndex}`.toLowerCase();

    return rows.filter((row) => {
      const ticketNumber = row.ticketNumber.toLowerCase();
      return (
        ticketNumber === dashedTicketNumber ||
        ticketNumber.replace(/-/g, "") === compactTicketNumber
      );
    });
  } catch (error) {
    console.error("turbopuffer searchTasks exact lookup error:", error);
    return [];
  }
}

function pinExactTaskRows(
  exactRows: TurbopufferTaskRow[],
  searchRows: TurbopufferTaskRow[],
  topK: number
): TurbopufferTaskRow[] {
  if (topK <= 0) return [];

  const seenIds = new Set<string>();
  const rows: TurbopufferTaskRow[] = [];

  for (const row of [...exactRows, ...searchRows]) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    rows.push(row);
    if (rows.length >= topK) break;
  }

  return rows;
}

async function searchCommentRowsWithBm25(
  query: string,
  topK: number,
  filters: unknown[] | undefined,
  limit: number
): Promise<TurbopufferCommentRow[]> {
  const response = await turbopuffer
    .namespace(turbopufferNamespaces.comment.name)
    .query({
      rank_by: buildCommentBm25RankBy(query),
      top_k: topK,
      filters,
      include_attributes: COMMENT_INCLUDE_ATTRIBUTES,
    } as any);

  return normalizeAndGroupCommentRows(
    (response.rows ?? []) as unknown as TurbopufferCommentRow[],
    limit
  );
}

function getMultiQueryRows<T>(response: unknown): T[] {
  const result = response as {
    results?: Array<{
      rows?: T[];
    }>;
  };

  return result.results?.[0]?.rows ?? [];
}

function normalizeAndGroupCommentRows(
  commentRows: TurbopufferCommentRow[],
  limit: number
): TurbopufferCommentRow[] {
  const rows = commentRows
    .map(normalizeCommentRow)
    .sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt));

  const seenTaskIds = new Set<string>();
  const groupedRows: TurbopufferCommentRow[] = [];

  for (const row of rows) {
    if (seenTaskIds.has(row.taskId)) continue;
    seenTaskIds.add(row.taskId);
    groupedRows.push(row);
    if (groupedRows.length >= limit) break;
  }

  return groupedRows;
}

function buildProjectFilter(projectIds: number[], projectId?: number | null) {
  const allowedProjectIds = uniqueNumbers(projectIds);
  if (allowedProjectIds.length === 0) return null;

  const narrowedProjectIds =
    projectId != null && allowedProjectIds.includes(projectId)
      ? [projectId]
      : allowedProjectIds;

  if (narrowedProjectIds.length === 1) {
    return ["projectId", "Eq", narrowedProjectIds[0]];
  }

  return ["projectId", "In", narrowedProjectIds];
}

function combineFilters(filters: Array<unknown[] | null>) {
  const compactFilters = filters.filter((filter): filter is unknown[] =>
    Boolean(filter)
  );

  if (compactFilters.length === 0) return undefined;
  if (compactFilters.length === 1) return compactFilters[0];
  return ["And", compactFilters];
}

function normalizeTaskRow(row: TurbopufferTaskRow): TurbopufferTaskRow {
  return {
    ...row,
    id: row.id.toString(),
    ticketNumber: stringify(row.ticketNumber),
    title: stringify(row.title),
    descriptionText: stringify(row.descriptionText),
    projectId: Number(row.projectId),
    creatorName: stringify(row.creatorName),
    status: stringify(row.status),
    updatedAt: stringify(row.updatedAt),
    searchText: stringify(row.searchText),
    uniqueIndex: Number(row.uniqueIndex),
    projectTitle: stringify(row.projectTitle),
  };
}

function normalizeCommentRow(row: TurbopufferCommentRow): TurbopufferCommentRow {
  return {
    ...row,
    id: row.id.toString(),
    taskId: row.taskId.toString(),
    commentText: stringify(row.commentText),
    creatorName: stringify(row.creatorName),
    projectId: Number(row.projectId),
    createdAt: stringify(row.createdAt),
    searchText: stringify(row.searchText),
    taskProjectId: Number(row.taskProjectId),
    taskProjectTitle: stringify(row.taskProjectTitle),
    taskTicketNumber: stringify(row.taskTicketNumber),
    taskTitle: stringify(row.taskTitle),
    taskStatus: stringify(row.taskStatus),
    taskUpdatedAt: stringify(row.taskUpdatedAt),
    taskUniqueIndex: Number(row.taskUniqueIndex),
  };
}

function normalizeCustomInstructionFileRow(
  row: TurbopufferCustomInstructionFileRow
): TurbopufferCustomInstructionFileRow {
  return {
    ...row,
    id: row.id.toString(),
    projectId: Number(row.projectId),
    teamId: stringify(row.teamId),
    source: stringify(row.source),
    fileName: stringify(row.fileName),
    fileType: stringify(row.fileType),
    content: stringify(row.content),
    searchText: stringify(row.searchText),
    chunkIndex: Number(row.chunkIndex),
    updatedAt: stringify(row.updatedAt),
  };
}

function uniqueNumbers(values: number[]) {
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value))
    )
  );
}

function buildSearchText(...parts: string[]) {
  return parts.filter(Boolean).join(" ");
}

function customInstructionFileRowId(
  projectId: number,
  source: string,
  chunkIndex: number
) {
  const sourceHash = createHash("sha256")
    .update(source)
    .digest("hex")
    .slice(0, 32);
  return `custom-instruction:${projectId}:${sourceHash}:${chunkIndex}`;
}

function chunkText(text: string, size: number, overlap: number) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + size);
    chunks.push(normalized.slice(start, end));
    if (end === normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stringify(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function dateValue(value: string) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function convertToPlain(htmlString: string = "") {
  const regex = /<[^>]*>/g;
  return htmlString.replace(regex, "");
}
