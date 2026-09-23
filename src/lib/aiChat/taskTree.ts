import { Prisma, PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

// HTPR-6509: the AI chat task-tree tool used to issue one query per ancestor
// hop and two queries per tree node. These helpers keep the exact output and
// error semantics but load the ancestor chain in one recursive query and the
// subtree one level at a time.

type Db = Pick<PrismaClient, "$queryRaw" | "task">;

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

// Builds the subtree with one query per level. A node at depth 0 has no
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
  let level = [root];
  let remainingDepth = depth;

  while (remainingDepth !== 0 && level.length > 0) {
    const childrenByParent = new Map<number, TaskTreeNode[]>();
    for (const node of level) {
      node.children = [];
      childrenByParent.set(node.id, node.children);
    }

    const rows = await db.task.findMany({
      where: {
        parentTaskId: { in: level.map((node) => node.id) },
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

    const nextLevel: TaskTreeNode[] = [];
    for (const row of rows) {
      const siblings =
        row.parentTaskId == null ? undefined : childrenByParent.get(row.parentTaskId);
      if (!siblings) continue;
      const child = toTreeNode(row);
      siblings.push(child);
      nextLevel.push(child);
    }

    level = nextLevel;
    remainingDepth =
      remainingDepth === undefined ? undefined : remainingDepth - 1;
  }

  return root;
}
