import { type ToolSet } from "ai";
import prisma from "@/lib/prisma";
import { toErrorMessage } from "@/lib/api/errorMessage";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { mapAttributedMcpAgent, mapVisibleMcpAgent } from "@/lib/mcp/agents";
import { overlayDurableAgentDisplayName } from "@/lib/agents/publicAgent";
import { withAdoptedAgentMutationLease } from "@/lib/mcp/tasks/agentMutationLeaseAdoption";
import { mapTaskToDetail as mapTaskToDetailBase, mapTaskToMcpGetResponse as mapTaskToMcpGetResponseBase } from "@/lib/mcp/tasks/mappers";
import { findTaskByIdentifier, TaskIdentifierAmbiguityError, validateTaskIdentifier } from "@/lib/mcp/tasks/resolveTask";
import { getViewUrl } from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { normalizeMime } from "@/lib/mcp/attachments/constants";
import createEstimateActivity from "@/utils/controllers/activities/createEstimateActivity";
import createPriorityActivity from "@/utils/controllers/activities/CreatePriorityActivity";
import { EstimateConstants, PriorityConstants } from "@/lib/constants/constants";
import { sanitizeBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import getMemberAndOwner from "@/utils/controllers/getMemberAndOwnerForBoard";
import type { IUser } from "@/models/model";
import { decideTaskIdentifierMatch, type ToolTaskIdentifierInput } from "./bulkTools";

export type AuthedUser = { id: number; email: string; displayName?: string | null };

export type ToolExecution = { name: string; result: unknown };

export type ToolExecutionRecorder = (execution: ToolExecution) => void;

export type ToolStartRelease = () => void | Promise<void>;

export type ToolStartRecorder = (
  name: string,
) => void | ToolStartRelease | Promise<void | ToolStartRelease>;

export function errorMessage(error: unknown) {
  // Prisma/driver errors carry schema and query detail, so those stay internal.
  if (error instanceof Error && error.name.startsWith("Prisma")) {
    console.error("[ai/chat/stream] internal error", error);
    return "Sorry, an error occurred while processing your request.";
  }
  // Tool loops and the error ticket need the provider's real text. The SDK
  // sometimes hands us a plain object, not an Error, and the generic fallback
  // then files a ticket with no cause.
  return toErrorMessage(
    error,
    "Sorry, an error occurred while processing your request.",
  );
}

export function trackToolSetExecutions(
  tools: ToolSet,
  recordToolExecution: ToolExecutionRecorder,
  recordToolStart?: ToolStartRecorder,
  leaseActor: { agentId: string; userId: number } | null = null
) {
  for (const [name, rawTool] of Object.entries(tools)) {
    const trackedTool = rawTool as {
      execute?: (...args: unknown[]) => unknown;
    };
    if (typeof trackedTool.execute !== "function") continue;

    const execute = trackedTool.execute;
    trackedTool.execute = async (...args: unknown[]) => {
      const release = await recordToolStart?.(name);
      try {
        // An agent-attributed task write is fenced and must hold the task's
        // lease, the one MCP clients take through POST /mcp/tasks/lease/claim.
        // Chat never claimed one, so an agent's moves, edits, archives and
        // description publishes were rejected as though another agent owned the
        // ticket. Human conversations pass no actor and are untouched.
        const result = await withAdoptedAgentMutationLease(
          prisma,
          leaseActor ?? {},
          async () => execute(...args)
        );
        recordToolExecution({ name, result });
        return result;
      } catch (error) {
        recordToolExecution({
          name,
          result: { success: false, error: errorMessage(error) },
        });
        throw error;
      } finally {
        if (typeof release === "function") {
          try {
            await release();
          } catch (error) {
            // A write may already be committed. Fence cleanup must never turn
            // that success into a retryable tool failure; Redis TTL is backup.
            console.error("[ai/chat/stream] tool fence cleanup failed", error);
          }
        }
      }
    };
  }
  return tools;
}

export function dropEmptyPadding<T extends Record<string, unknown>>(
  input: T,
  fields: (keyof T)[]
): T {
  const cleaned = { ...input };
  for (const field of fields) {
    const value = cleaned[field];
    const empty =
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (empty) delete cleaned[field];
  }
  return cleaned;
}

export function withToolErrors<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  }) as T;
}

export type ResolvedToolTask = NonNullable<Awaited<ReturnType<typeof findTaskByIdentifier>>>;

export type ResolveTaskForToolResult =
  | { task: ResolvedToolTask; error?: never }
  | { task: null; error?: string };

export async function resolveTaskForTool(
  user: AuthedUser,
  input: ToolTaskIdentifierInput
): Promise<ResolveTaskForToolResult> {
  const ticketNumber = input.ticket_number?.trim();
  const hasTaskId = input.task_id != null;
  const hasTicketNumber = Boolean(ticketNumber);
  const hasUniqueIndex = input.unique_index != null;
  const hasProjectId = input.project_id != null;
  const triedIdentifiers: string[] = [];

  if (!hasTaskId && !hasTicketNumber && !hasUniqueIndex) {
    const validation = validateTaskIdentifier({
      task_id: input.task_id,
      ticket_number: ticketNumber,
      unique_index: input.unique_index,
      project_id: input.project_id,
    });
    return { task: null, error: validation.error };
  }

  if (hasTaskId || ticketNumber) {
    if (hasTaskId) triedIdentifiers.push(`task_id=${input.task_id}`);
    if (ticketNumber) {
      triedIdentifiers.push(
        hasProjectId
          ? `ticket_number=${ticketNumber}, project_id=${input.project_id}`
          : `ticket_number=${ticketNumber}`
      );
    }

    try {
      const ticketMatch = ticketNumber
        ? await findTaskByIdentifier(user, {
            ticket_number: ticketNumber,
            ...(hasProjectId ? { project_id: input.project_id } : {}),
          })
        : null;
      const taskMatch = hasTaskId
        ? await findTaskByIdentifier(user, {
            task_id: input.task_id,
            ...(hasProjectId ? { project_id: input.project_id } : {}),
          })
        : null;
      const unscopedTaskMatch =
        hasTaskId && hasProjectId && !taskMatch
          ? await findTaskByIdentifier(user, { task_id: input.task_id })
          : null;
      const decision = decideTaskIdentifierMatch({
        taskId: hasTaskId ? input.task_id : undefined,
        ticketNumber,
        projectId: hasProjectId ? input.project_id : undefined,
        taskMatch,
        ticketMatch,
        unscopedTaskMatch,
      });
      if (decision.error) return { task: null, error: decision.error };
      if (decision.match) return { task: decision.match };
    } catch (error) {
      if (error instanceof TaskIdentifierAmbiguityError) {
        return { task: null, error: error.message };
      }
      throw error;
    }
  }

  if (hasUniqueIndex && hasProjectId) {
    triedIdentifiers.push(
      `unique_index=${input.unique_index}, project_id=${input.project_id}`
    );
    const task = await findTaskByIdentifier(user, {
      unique_index: input.unique_index,
      project_id: input.project_id,
    });
    if (task) return { task };
  }

  if (hasUniqueIndex && !hasProjectId && !hasTaskId && !hasTicketNumber) {
    const validation = validateTaskIdentifier({
      unique_index: input.unique_index,
      project_id: input.project_id,
    });
    if (!validation.valid) return { task: null, error: validation.error };
  }

  return {
    task: null,
    error: `Task not found or access denied. Tried identifiers: ${triedIdentifiers.join("; ")}. None of these matched a task you can access. Call hypertask_search_tasks for the task title, then copy the \`task_id\` field from the result verbatim -- do not derive identifiers from task titles.`,
  };
}

export function sanitizeForJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, raw) =>
      typeof raw === "bigint" ? raw.toString() : raw
    )
  ) as T;
}

export async function getAccessibleProjectIds(userId: number) {
  const projects = await prisma.project.findMany({
    where: {
      status: "Normal",
      ...getProjectWhere(userId),
    },
    select: { id: true },
  });
  return projects.map((project) => project.id);
}

export async function assertAccessibleProject(userId: number, projectId: number) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: "Normal",
      ...getProjectWhere(userId),
    },
    select: { id: true },
  });
  return Boolean(project);
}

export function buildActivityUser(userObj: {
  id: number;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}): IUser {
  return {
    id: userObj.id,
    email: userObj.email ?? undefined,
    displayName: userObj.displayName ?? undefined,
    photoURL: userObj.photoURL ?? undefined,
    uid: "",
    stripe_customer_id: "",
    joinedAt: new Date(),
    UserSettingId: "",
    UserSetting: {} as IUser["UserSetting"],
  };
}

export async function applyPriorityUpdate(
  taskId: number,
  priorityValue: string,
  userId: number,
  activityUser: IUser
): Promise<{ error: string | null }> {
  const constant = PriorityConstants.find((p) => p.Priority_Value === priorityValue);
  if (!constant) return { error: `Invalid priority "${priorityValue}"` };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { priority: true },
  });
  if (!task) return { error: "Task not found" };

  if (constant.priority_index === 0) {
    if (task.priority) {
      await prisma.priority.deleteMany({ where: { taskId } });
      await createPriorityActivity({
        userObj: activityUser,
        taskId,
        toPriority: { priority_index: 0, Priority_Value: "No Priority" },
        fromPriority: {
          priority_index: task.priority.priority_index,
          Priority_Value: task.priority.Priority_Value,
        },
      });
    }
    return { error: null };
  }

  if (!task.priority) {
    const priority = await prisma.priority.create({
      data: {
        taskId,
        sectionId: task.sectionId ?? -1,
        projectId: task.projectId,
        addedByUserId: userId,
        priority_index: constant.priority_index,
        Priority_Value: constant.Priority_Value,
      },
    });
    await createPriorityActivity({
      userObj: activityUser,
      taskId,
      toPriority: {
        priority,
        priority_index: constant.priority_index,
        Priority_Value: constant.Priority_Value,
      },
    });
  } else if (task.priority.priority_index !== constant.priority_index) {
    const updated = await prisma.priority.update({
      where: { id: task.priority.id },
      data: {
        addedByUserId: userId,
        priority_index: constant.priority_index,
        Priority_Value: constant.Priority_Value,
      },
    });
    await createPriorityActivity({
      userObj: activityUser,
      taskId,
      toPriority: {
        priority: updated,
        priority_index: constant.priority_index,
        Priority_Value: constant.Priority_Value,
      },
      fromPriority: {
        priority: task.priority,
        priority_index: task.priority.priority_index,
        Priority_Value: task.priority.Priority_Value,
      },
    });
  }
  return { error: null };
}

export async function applyEstimateUpdate(
  taskId: number,
  estimateIndex: number,
  userId: number,
  activityUser: IUser
): Promise<{ error: string | null }> {
  const constant = EstimateConstants.find(
    (estimate) => estimate.estimate_index === estimateIndex
  );
  if (!constant) return { error: `Invalid estimate "${estimateIndex}"` };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { estimate: true },
  });
  if (!task) return { error: "Task not found" };

  if (constant.estimate_index === 0) {
    if (task.estimate) await prisma.estimate.deleteMany({ where: { taskId } });
    return { error: null };
  }

  if (!task.estimate) {
    const estimate = await prisma.estimate.create({
      data: {
        taskId,
        sectionId: task.sectionId ?? -1,
        projectId: task.projectId,
        addedByUserId: userId,
        estimate_index: constant.estimate_index,
        estimate_value: constant.estimate_value,
      },
    });
    await createEstimateActivity({
      fromUser: activityUser,
      taskId,
      toEstimate: {
        estimate,
        estimate_index: constant.estimate_index,
        estimate_value: constant.estimate_value,
      },
    });
  } else if (task.estimate.estimate_index !== constant.estimate_index) {
    const updated = await prisma.estimate.update({
      where: { id: task.estimate.id },
      data: {
        addedByUserId: userId,
        estimate_index: constant.estimate_index,
        estimate_value: constant.estimate_value,
        updatedAt: new Date(),
      },
    });
    await createEstimateActivity({
      fromUser: activityUser,
      taskId,
      toEstimate: {
        estimate: updated,
        estimate_index: constant.estimate_index,
        estimate_value: constant.estimate_value,
      },
      fromEstimate: {
        estimate: task.estimate,
        estimate_index: task.estimate.estimate_index,
        estimate_value: task.estimate.estimate_value,
      },
    });
  }
  return { error: null };
}

export function normalizePriorityInput(priority?: string | string[]) {
  if (!priority) return undefined;
  return Array.isArray(priority) ? priority : [priority];
}

export function mapTaskToMcpGetResponse(task: any, userId: number) {
  const mapped = mapTaskToMcpGetResponseBase(task, userId);
  type TaskReference = { id: number } & Record<string, unknown>;
  const parentTask = (mapped as { parent_task?: TaskReference }).parent_task;
  const subTasks = (mapped as { sub_tasks?: TaskReference[] }).sub_tasks;

  return {
    ...mapped,
    task_id: task.id,
    parent_task: parentTask
      ? { ...parentTask, task_id: parentTask.id }
      : parentTask,
    sub_tasks: subTasks?.map((subTask) => ({
      ...subTask,
      task_id: subTask.id,
    })),
  };
}

export function mapTaskToDetail(task: any, userId: number) {
  return {
    ...mapTaskToDetailBase(task, userId),
    task_id: task.id,
  };
}

export function mapTaskSearchItem(task: any, userId: number) {
  const agent = mapVisibleMcpAgent(task.agent, userId, task.projectId);
  return {
    id: task.id,
    task_id: task.id,
    ticketNumber: task.ticketNumber || undefined,
    uniqueIndex: task.uniqueIndex,
    // Ready-made board-relative link. Use this verbatim for links; never build
    // the path from `id` (global DB id, not the ticket number).
    url: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
    title: task.title,
    // Descriptions carry inline base64 images for the same reason comments do.
    description: stripInlineDataUris(task.description),
    boardId: task.projectId,
    boardTitle: task.project.title || "",
    projectId: task.projectId,
    section: task.section,
    dueDate: task.dueDate?.toISOString() || undefined,
    createdAt: task.createdAt.toISOString(),
    ...(agent ? { agent } : {}),
  };
}

export const stripInlineDataUris = (html: string) =>
  typeof html === "string"
    ? html.replace(/\bdata:[^;,\s"')]+;base64,[A-Za-z0-9+/=]+/g, "[inline image]")
    : html;

export function mapCommentToResponse(comment: any, userId: number, projectId: number) {
  const agent = mapVisibleMcpAgent(comment.agent, userId, projectId);
  const hasAgentAttribution = Boolean(comment.agent || comment.agentDisplayName);
  const text = stripInlineDataUris(comment.text);
  return {
    id: comment.id,
    text,
    commentText: comment.commentText || text,
    createdAt: comment.createdAt.toISOString(),
    creatorId: comment.creatorId || undefined,
    creator: comment.creator
      ? {
          id: comment.creator.id,
          email: comment.creator.email,
          displayName: comment.creator.displayName || undefined,
        }
      : undefined,
    ...(agent ? { agent } : {}),
    ...(hasAgentAttribution
      ? { agent_display_name: agent?.displayName || "Private agent" }
      : {}),
    attachments: (comment.attachments ?? []).map((attachment: any) => ({
      id: attachment.id,
      fileName: attachment.fileName || "",
      fileType: attachment.fileType,
      fileSize: attachment.fileSize
        ? typeof attachment.fileSize === "string"
          ? parseInt(attachment.fileSize) || 0
          : attachment.fileSize
        : 0,
      fileSource: attachment.fileSource || "",
    })),
    reactions: (comment.reactions ?? []).map((reaction: any) => ({
      id: reaction.id,
      emoji: reaction.emoji,
      userId: reaction.userId,
    })),
  };
}

export function applyDurableCommentAttribution<T extends object>(
  mapped: T,
  comment: any,
  userId: number,
  projectId: number,
  attributionEnabled: boolean
): T {
  if (!attributionEnabled)
  return overlayDurableAgentDisplayName(mapped, {
    hasAgentRow: Boolean(comment.agent),
    visibleAgent: mapVisibleMcpAgent(comment.agent, userId, projectId),
    storedDisplayName: comment.agentDisplayName,
    attributionEnabled,
  });

  const agent = mapAttributedMcpAgent(comment.agent);
  return overlayDurableAgentDisplayName(
    { ...mapped, ...(agent ? { agent } : {}) },
    {
      hasAgentRow: Boolean(comment.agent),
      visibleAgent: agent,
      storedDisplayName: comment.agentDisplayName,
      attributionEnabled,
    },
  );
}

export function mapDraftToResponse(draft: any) {
  return {
    id: draft.id,
    taskId: draft.taskId,
    ticketNumber: draft.task?.ticketNumber || undefined,
    draftType: String(draft.type || "").toLowerCase(),
    text: draft.content || "",
    status: "Draft",
    updatedAt:
      draft.updatedAt instanceof Date ? draft.updatedAt.toISOString() : draft.updatedAt,
    createdBy: draft.user
      ? {
          id: draft.user.id,
          email: draft.user.email,
          displayName: draft.user.displayName || undefined,
        }
      : undefined,
  };
}

export function userHasProjectAccess(
  project: { ownerId?: number | null; members?: { userId: number }[] } | null | undefined,
  userId: number
) {
  return Boolean(
    project &&
      (project.ownerId === userId ||
        project.members?.some((member) => member.userId === userId))
  );
}

export async function findDraftWithAccess(draftId: number) {
  return prisma.drafts.findUnique({
    where: { id: draftId },
    include: {
      task: {
        include: {
          project: {
            select: {
              ownerId: true,
              members: { select: { userId: true } },
            },
          },
        },
      },
      user: { select: { id: true, email: true, displayName: true } },
    },
  });
}

export async function validateMentionUsers(
  projectId: number,
  mentions:
    | {
        user_id: number;
        display_name: string;
      }[]
    | undefined
) {
  if (!mentions?.length) return null;
  return validateMentionUserIds(
    projectId,
    mentions.map((mention) => mention.user_id)
  );
}

export async function validateMentionUserIds(projectId: number, userIds: number[]) {
  if (userIds.length === 0) return null;
  const allowedMemberIds = await getMemberAndOwner(projectId);
  if (typeof allowedMemberIds === "string") {
    return "Could not resolve project members";
  }
  const allowedSet = new Set<number>(allowedMemberIds);
  const invalidUserIds = [...new Set(userIds)].filter((id) => !allowedSet.has(id));
  if (invalidUserIds.length > 0) {
    return `Mentioned user(s) ${invalidUserIds.join(", ")} are not members of this project.`;
  }
  return null;
}

export const CHAT_ATTACHMENT_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
  "text/markdown": ".md",
  "text/plain": ".txt",
};

export function deriveChatAttachmentFilename(
  urlString: string,
  contentType: string,
  index: number
) {
  try {
    const lastSegment = new URL(urlString).pathname
      .split("/")
      .filter(Boolean)
      .pop();
    if (lastSegment) {
      const decoded = decodeURIComponent(lastSegment).trim();
      if (
        decoded &&
        decoded.length <= 255 &&
        !decoded.includes("/") &&
        !decoded.includes("\\") &&
        !decoded.includes("..")
      ) {
        return decoded;
      }
    }
  } catch {
    // Fall through to a deterministic filename; URL validity is enforced below.
  }

  return `attachment-${index + 1}${
    CHAT_ATTACHMENT_EXTENSION_BY_MIME[normalizeMime(contentType)] || ""
  }`;
}

export type TaskTreeNode = {
  id: number;
  task_id: number;
  ticketNumber?: string;
  title: string;
  uniqueIndex?: number;
  children?: TaskTreeNode[];
};

export const MAX_TREE_ANCESTOR_HOPS = 256;

export async function findRootTaskIdForTree(
  anchorTaskId: number,
  userId: number
): Promise<{ rootId: number } | { error: string }> {
  const visited = new Set<number>();
  let currentId = anchorTaskId;

  for (let hop = 0; hop < MAX_TREE_ANCESTOR_HOPS; hop++) {
    if (visited.has(currentId)) {
      return { error: "Invalid parent chain (cycle detected)" };
    }
    visited.add(currentId);

    const task = await prisma.task.findFirst({
      where: {
        id: currentId,
        project: getProjectWhere(userId),
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

export async function buildTaskTreeNode(
  taskId: number,
  userId: number,
  remainingDepth: number | undefined
): Promise<TaskTreeNode> {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
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

  const node: TaskTreeNode = {
    id: task.id,
    task_id: task.id,
    title: task.title,
  };
  if (task.ticketNumber) node.ticketNumber = task.ticketNumber;
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
      project: getProjectWhere(userId),
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
    childrenRows.map((row) => buildTaskTreeNode(row.id, userId, nextDepth))
  );

  return { ...node, children };
}

export function isoDate(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ?? undefined;
}

export function mapViewToResponse(view: any, projectView: any, includeSettings = false) {
  const response: Record<string, unknown> = {
    id: view.id,
    title: view.title || "",
    slug: view.slug ?? null,
    url:
      view.slug && projectView?.project?.id
        ? getViewUrl(projectView.project.id, view.slug)
        : null,
    visibility: view.visibility,
    createdAt: isoDate(view.createdAt),
    lastUsedAt: view.ViewLastUsed?.[0]?.lastUsedAt
      ? isoDate(view.ViewLastUsed[0].lastUsedAt)
      : isoDate(view.lastUsedAt),
    owner: view.owner
      ? {
          id: view.owner.id,
          email: view.owner.email,
          displayName: view.owner.displayName || undefined,
        }
      : undefined,
    project: projectView?.project
      ? {
          id: projectView.project.id,
          name: projectView.project.name,
          title: projectView.project.title || undefined,
        }
      : undefined,
    is_default: projectView?.default_view_id === view.id,
    board_sorting_stack: view.board_sorting_stack,
  };

  if (includeSettings) {
    response.board_sorting_mode = view.board_sorting_mode;
    response.board_sorting_order = view.board_sorting_order;
    response.board_filters = sanitizeBoardFilters(view.board_filters) || undefined;
    response.board_columns_view = view.board_columns_view || undefined;
    response.board_subtask_setting = view.board_subtask_setting;
    response.board_empty_sections = view.board_empty_sections;
  }

  return response;
}
