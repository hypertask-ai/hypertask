import { NextRequest, NextResponse } from "next/server";
import { validateMcpAuth, checkMcpRateLimit } from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";
import { findTaskByIdentifier } from "@/lib/mcp/tasks/resolveTask";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

/**
 * Recursive task node for parent/subtask hierarchy.
 */
export interface TaskTreeNode {
  id: number;
  ticketNumber?: string;
  title: string;
  uniqueIndex?: number;
  children?: TaskTreeNode[];
}

export interface TaskTreeResponse {
  success: boolean;
  tree: TaskTreeNode;
}

/** Max parent hops when walking to root (guards against cycles / bad data). */
const MAX_ANCESTOR_HOPS = 256;


/**
 * Parse and validate query params for GET /api/mcp/tasks/tree.
 * Exactly one of task_id or ticket_number is required.
 *
 * `depth` (optional): number of descendant levels to include below the root.
 * - Omit → full subtree (non-deleted children only).
 * - 0 → root only (no `children` on the root).
 * - D ≥ 1 → root expands children; each level decrements D until 0, then that node has no `children`.
 */
function parseTreeQuery(searchParams: URLSearchParams):
  | {
      ok: true;
      task_id?: number;
      ticket_number?: string;
      depth?: number;
    }
  | { ok: false; error: string } {
  const rawTaskId = searchParams.get("task_id");
  const rawTicket = searchParams.get("ticket_number");
  const rawDepth = searchParams.get("depth");

  const hasTaskId = rawTaskId !== null && rawTaskId !== "";
  const hasTicket = rawTicket !== null && rawTicket.trim().length > 0;

  if (hasTaskId && hasTicket) {
    return {
      ok: false,
      error: "Provide exactly one of task_id or ticket_number, not both",
    };
  }
  if (!hasTaskId && !hasTicket) {
    return {
      ok: false,
      error: "Provide exactly one of task_id or ticket_number",
    };
  }

  let task_id: number | undefined;
  if (hasTaskId) {
    const n = parseInt(rawTaskId!.trim(), 10);
    if (Number.isNaN(n) || n < 1) {
      return { ok: false, error: "task_id must be a positive integer" };
    }
    task_id = n;
  }

  let ticket_number: string | undefined;
  if (hasTicket) {
    const t = rawTicket!.trim();
    if (t.length < 1) {
      return { ok: false, error: "ticket_number must be a non-empty string" };
    }
    ticket_number = t;
  }

  let depth: number | undefined;
  if (rawDepth !== null && rawDepth !== "") {
    const d = parseInt(rawDepth.trim(), 10);
    if (Number.isNaN(d) || d < 0) {
      return { ok: false, error: "depth must be a non-negative integer" };
    }
    depth = d;
  }

  return { ok: true, task_id, ticket_number, depth };
}

async function findRootTaskId(
  anchorTaskId: number,
  userId: number,
  agentId?: string | null
): Promise<{ rootId: number } | { error: string }> {
  const visited = new Set<number>();
  let currentId = anchorTaskId;

  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
    if (visited.has(currentId)) {
      return { error: "Invalid parent chain (cycle detected)" };
    }
    visited.add(currentId);

    const task = await prisma.task.findFirst({
      where: {
        id: currentId,
        project: getProjectWhere(userId, agentId),
      },
      select: { id: true, parentTaskId: true },
    });

    if (!task) {
      return { error: "Task not found or access denied" };
    }

    if (task.parentTaskId == null) {
      return { rootId: task.id };
    }

    currentId = task.parentTaskId;
  }

  return { error: "Parent chain exceeds maximum depth" };
}

/**
 * `remainingDepth`: undefined = full subtree; 0 = do not attach children; n > 0 = recurse with n - 1 per child.
 * When truncated by depth, `children` is omitted on that node. When there are no subtasks, `children` is [].
 */
async function buildTreeNode(
  taskId: number,
  userId: number,
  remainingDepth: number | undefined,
  agentId?: string | null
): Promise<TaskTreeNode> {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      project: getProjectWhere(userId, agentId),
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

  const node: TaskTreeNode = {
    id: task.id,
    title: task.title,
  };
  if (task.ticketNumber) {
    node.ticketNumber = task.ticketNumber;
  }
  if (task.uniqueIndex !== undefined && task.uniqueIndex !== null) {
    node.uniqueIndex = task.uniqueIndex;
  }

  if (remainingDepth === 0) {
    return node;
  }

  const childrenRows = await prisma.task.findMany({
    where: {
      parentTaskId: taskId,
      status: { not: "Deleted" },
      project: getProjectWhere(userId, agentId),
    },
    select: { id: true },
    orderBy: { uniqueIndex: "asc" },
  });

  if (childrenRows.length === 0) {
    return { ...node, children: [] };
  }

  const nextDepth =
    remainingDepth === undefined ? undefined : remainingDepth - 1;
  const children = await Promise.all(
    childrenRows.map((row) => buildTreeNode(row.id, userId, nextDepth, agentId))
  );

  return { ...node, children };
}

/**
 * GET /api/mcp/tasks/tree
 *
 * Returns the full family tree for a task: the topmost ancestor as `tree`, with nested subtasks.
 * Query: exactly one of `task_id` (positive int) or `ticket_number` (non-empty string).
 * Optional `depth` (non-negative int) limits how many descendant levels are expanded below the root.
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized. Invalid or missing authentication token.",
        },
        { status: 401 }
      );
    }
    const user = ctx.user;
    const parsed = parseTreeQuery(request.nextUrl.searchParams);
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, error: parsed.error },
        { status: 400 }
      );
    }

    const anchor = await findTaskByIdentifier(
      user,
      {
        task_id: parsed.task_id ?? null,
        ticket_number: parsed.ticket_number ?? null,
        unique_index: null,
        project_id: null,
      },
      ctx.agentId
    );

    if (!anchor) {
      return NextResponse.json(
        { success: false, error: "Task not found or access denied" },
        { status: 404 }
      );
    }

    const rootResult = await findRootTaskId(anchor.id, user.id, ctx.agentId);
    if ("error" in rootResult) {
      const status =
        rootResult.error.includes("cycle") ||
        rootResult.error.includes("maximum")
          ? 400
          : 404;
      return NextResponse.json(
        { success: false, error: rootResult.error },
        { status }
      );
    }

    const tree = await buildTreeNode(
      rootResult.rootId,
      user.id,
      parsed.depth,
      ctx.agentId
    );

    const body: TaskTreeResponse = {
      success: true,
      tree,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("Error building task tree:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
