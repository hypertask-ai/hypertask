import { Prisma, PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

// HTPR-6509: the AI chat task-tree tool used to issue one query per ancestor
// hop and two queries per tree node. These helpers keep the exact output and
// error semantics but load the ancestor chain in one recursive query and the
// subtree with a single authorized recursive read.

type Db = Pick<PrismaClient, "$queryRaw" | "task" | "project">;

export type TaskTreeNode = {
  id: number;
  task_id: number;
  ticketNumber?: string;
  title: string;
  uniqueIndex?: number;
  children?: TaskTreeNode[];
};

export const MAX_TREE_ANCESTOR_HOPS = 256;

type AncestorRow = { id: number; parentTaskId: number | null };

// Walks up from the anchor without access filtering, returning at most
// MAX_TREE_ANCESTOR_HOPS rows (hop 0 is the anchor). It stops before revisiting
// a task, so cycles terminate; the caller replays the walk to report them.
export function ancestorChainSql(anchorTaskId: number) {
  return Prisma.sql`
    WITH RECURSIVE chain AS (
      SELECT t.id, t."parentTaskId", 0 AS hop, ARRAY[t.id] AS path
      FROM "Task" t
      WHERE t.id = ${anchorTaskId}
      UNION ALL
      SELECT t.id, t."parentTaskId", c.hop + 1, c.path || t.id
      FROM chain c
      JOIN "Task" t ON t.id = c."parentTaskId"
      WHERE c.hop + 1 < ${MAX_TREE_ANCESTOR_HOPS} AND NOT t.id = ANY(c.path)
    )
    SELECT id, "parentTaskId" FROM chain ORDER BY hop
  `;
}

export async function findRootTaskIdForTree(
  anchorTaskId: number,
  userId: number,
  db: Db = prisma
): Promise<{ rootId: number } | { error: string }> {
  const chain = await db.$queryRaw<AncestorRow[]>(ancestorChainSql(anchorTaskId));
  const parentById = new Map(chain.map((row) => [row.id, row.parentTaskId]));
  const accessibleIds =
    chain.length === 0
      ? new Set<number>()
      : new Set(
          (
            await db.task.findMany({
              where: {
                id: { in: chain.map((row) => row.id) },
                project: getProjectWhere(userId),
              },
              select: { id: true },
            })
          ).map((row) => row.id)
        );

  // Replays the original one-query-per-hop walk so cycle, access and depth
  // errors come back in the same order as before.
  const visited = new Set<number>();
  let currentId = anchorTaskId;

  for (let hop = 0; hop < MAX_TREE_ANCESTOR_HOPS; hop++) {
    if (visited.has(currentId)) {
      return { error: "Invalid parent chain (cycle detected)" };
    }
    visited.add(currentId);

    const parentTaskId = parentById.get(currentId);
    if (parentTaskId === undefined || !accessibleIds.has(currentId)) {
      return { error: "Task not found or access denied" };
    }

    if (parentTaskId == null) {
      return { rootId: currentId };
    }

    currentId = parentTaskId;
  }

  return { error: "Parent chain exceeds maximum depth" };
}

function toTreeNode(task: {
  id: number;
  ticketNumber: string | null;
  title: string;
  uniqueIndex: number | null;
}): TaskTreeNode {
  const node: TaskTreeNode = {
    id: task.id,
    task_id: task.id,
    title: task.title,
  };
  if (task.ticketNumber) node.ticketNumber = task.ticketNumber;
  if (task.uniqueIndex !== undefined && task.uniqueIndex !== null) {
    node.uniqueIndex = task.uniqueIndex;
  }
  return node;
}

// A node at depth 0 has no
// `children` key; any other node gets `children`, empty when it has none.
export async function buildTaskTree(
  rootId: number,
  userId: number,
  depth: number | undefined,
  db: Db = prisma
): Promise<TaskTreeNode> {
  const task = await db.task.findFirst({
    where: {
      id: rootId,
      project: getProjectWhere(userId),
    },
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      uniqueIndex: true,
    },
  });

  if (!task) {
    throw new Error("Task not found in tree build");
  }

  const root = toTreeNode(task);
  if (depth === 0) return root;

  type ChildRow = {
    id: number;
    parentTaskId: number | null;
    ticketNumber: string | null;
    title: string;
    uniqueIndex: number | null;
  };
  let rows: ChildRow[];
  if (depth === 1) {
    rows = await db.task.findMany({
      where: {
        parentTaskId: rootId,
        status: { not: "Deleted" },
        project: getProjectWhere(userId),
      },
      select: {
        id: true,
        parentTaskId: true,
        ticketNumber: true,
        title: true,
        uniqueIndex: true,
      },
      orderBy: { uniqueIndex: "asc" },
    });
  } else {
    // Compute board access through the shared predicate before recursion. A
    // hidden or deleted parent must prune its descendants, not just its own row.
    const projects = await db.project.findMany({
      where: getProjectWhere(userId),
      select: { id: true },
    });
    const projectIds = projects.map(({ id }) => id);
    rows = await db.$queryRaw<ChildRow[]>(Prisma.sql`
      WITH RECURSIVE bounds AS (
        SELECT ${rootId}::integer AS root_id, ${depth ?? null}::bigint AS max_depth,
          ${projectIds}::integer[] AS project_ids
      ), subtree AS (
        SELECT t.id, t."parentTaskId", t."ticketNumber", t.title, t."uniqueIndex", 1 AS hop
        FROM "Task" t CROSS JOIN bounds b
        WHERE t."parentTaskId" = b.root_id AND t.status <> 'Deleted'
          AND t."projectId" = ANY(b.project_ids)
        UNION ALL
        SELECT t.id, t."parentTaskId", t."ticketNumber", t.title, t."uniqueIndex", s.hop + 1
        FROM subtree s JOIN "Task" t ON t."parentTaskId" = s.id CROSS JOIN bounds b
        WHERE t.status <> 'Deleted' AND t."projectId" = ANY(b.project_ids)
          AND (b.max_depth IS NULL OR s.hop < b.max_depth)
      )
      SELECT DISTINCT id, "parentTaskId", "ticketNumber", title, "uniqueIndex"
      FROM subtree ORDER BY "uniqueIndex" ASC
    `);
  }

  const rowsByParent = new Map<number, ChildRow[]>();
  for (const row of rows) {
    if (row.parentTaskId == null) continue;
    const siblings = rowsByParent.get(row.parentTaskId) ?? [];
    siblings.push(row);
    rowsByParent.set(row.parentTaskId, siblings);
  }
  let level = [root];
  let remainingDepth = depth;

  while (remainingDepth !== 0 && level.length > 0) {
    const nextLevel: TaskTreeNode[] = [];
    for (const node of level) {
      node.children = (rowsByParent.get(node.id) ?? []).map(toTreeNode);
      for (const child of node.children) nextLevel.push(child);
    }

    level = nextLevel;
    remainingDepth =
      remainingDepth === undefined ? undefined : remainingDepth - 1;
  }

  return root;
}
