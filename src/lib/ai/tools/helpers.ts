import { mcpVisibleAgentSelect, mapVisibleMcpAgent } from "@/lib/mcp/agents";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { type IUser } from "@/models/model";
import { PriorityConstants, EstimateConstants } from "@/lib/constants/constants";
import createPriorityActivity from "@/utils/controllers/activities/CreatePriorityActivity";
import createEstimateActivity from "@/utils/controllers/activities/createEstimateActivity";
import { mapTaskToMcpGetResponse as mapTaskToMcpGetResponseBase, mapTaskToDetail as mapTaskToDetailBase } from "@/lib/mcp/tasks/mappers";
import { overlayDurableAgentDisplayName } from "@/lib/agents/publicAgent";
import getMemberAndOwner from "@/utils/controllers/getMemberAndOwnerForBoard";
import { normalizeMime } from "@/lib/mcp/attachments/constants";
import { getViewUrl } from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { sanitizeBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";

export const commentInclude = (userId: number, projectId: number) => ({
  creator: {
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  },
  agent: {
    select: mcpVisibleAgentSelect(userId, projectId),
  },
  attachments: {
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      fileSource: true,
    },
  },
  reactions: {
    where: {
      isDeleted: false,
    },
    select: {
      id: true,
      emoji: true,
      userId: true,
    },
  },
}) satisfies Prisma.CommentInclude;

export function sanitizeForJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, raw) =>
      typeof raw === "bigint" ? raw.toString() : raw
    )
  ) as T;
}

// Every rich-text value the chat persists (comments, drafts, descriptions) goes through
// here first. Asking the model for HTML is not enough — it drifts back to markdown and
// the raw asterisks end up in the comment (HTPR-4687), so the conversion is forced.
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

/** Builds an IUser-shaped object for activity/notification helpers that require one. */
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

/**
 * When this ChatSession targets a native agent, loads its prompt so the model
 * can be instructed to act as that agent, and its id so the write tools can
 * attribute the mutations they make to the agent instead of the human user.
 * Ownership is re-checked here (not just trusted from session creation) since
 * this is the boundary that decides whose identity mutations are stamped with.
 */
/**
 * No try/catch: a query error here is indistinguishable from "this session
 * has an agent" (we simply don't know yet), so swallowing it to null would
 * silently attribute a real agent's writes to the human on a DB hiccup.
 * Errors propagate to the existing top-level stream catch, same as every
 * other lookup in this request (dbUser, task context, etc).
 */
export async function loadActingAgent(
  sessionId: string | undefined,
  userId: number
): Promise<{
  id: string;
  displayName: string;
  prompt: string | null;
  modelOptionId: string | null;
} | null> {
  if (!sessionId) return null;

  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
    select: { agentId: true },
  });
  if (!session?.agentId) return null;

  return prisma.agent.findFirst({
    where: {
      id: session.agentId,
      userId,
      runtimeType: "NATIVE",
      revokedAt: null,
    },
    select: {
      id: true,
      displayName: true,
      prompt: true,
      modelOptionId: true,
    },
  });
}

/** Creates, updates, or clears a task's Priority row and logs the activity (mirrors src/pages/api/priority/setPriority.ts). */
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

/** Creates, updates, or clears a task's Estimate row and logs the activity (mirrors src/pages/api/estimate/setEstimate.ts). */
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

// A comment written in the editor can carry an image inline as a base64 data
// URI. Those are megabytes of text, and the model was being handed them whole,
// which is what produced "prompt is too large" whenever a comment held a
// screenshot (HTPR-3494). The image itself is still reachable through the
// comment's attachments, so the model loses nothing by seeing a marker here.
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
  return overlayDurableAgentDisplayName(mapped, {
    hasAgentRow: Boolean(comment.agent),
    visibleAgent: mapVisibleMcpAgent(comment.agent, userId, projectId),
    storedDisplayName: comment.agentDisplayName,
    attributionEnabled,
  });
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

  return `attachment-${index + 1}${CHAT_ATTACHMENT_EXTENSION_BY_MIME[normalizeMime(contentType)] || ""
    }`;
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
