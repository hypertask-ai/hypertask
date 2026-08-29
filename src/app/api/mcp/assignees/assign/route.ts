import { NextRequest, NextResponse } from "next/server";
import { validateMcpAuth, checkMcpRateLimit } from "@/lib/mcp/auth";
import type { McpAgentSummary } from "@/lib/mcp/agents";
import { getMcpSessionAgentSummary, mapMcpAgent, mcpAgentSelect } from "@/lib/mcp/agents";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import assigneesAssign from "@/utils/controllers/assignees/assign";
import getMemberAndOwner from "@/utils/controllers/getMemberAndOwnerForBoard";
import { IUser } from "@/models/model";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { ACTIVE_TASK_MUTATION_STATUS } from "@/lib/mcp/tasks/activeTaskMutation";

export interface McpAssigneeResponseItem {
  userId: number;
  agent?: McpAgentSummary;
  agentAssigner?: McpAgentSummary;
}

interface AssignBody {
  task_id?: number;
  ticket_number?: string;
  project_id?: number;
  unique_index?: number;
  user_id?: number;
  user_ids?: number[];
  mode?: "multiple";
  /** Agent-only: add the calling agent itself as an assignee. No user_id needed. */
  assign_self?: boolean;
  /** Owner-only: assign or unassign one of your own agents by id. No user_id needed. */
  agent_id?: string;
  /** Default `assign` (idempotent). Use `unassign` to remove assignee; omit legacy toggle. */
  intent?: "assign" | "unassign";
}

interface AssignmentResult {
  assignStatus: "Assigned" | "Unassigned" | "Conflict";
  assignmentOutcome?: "created" | "already-assigned" | "stale-task";
}

async function findTaskByIdentifier(
  user: { id: number },
  agentId: string | null | undefined,
  options: {
    task_id?: number | null;
    ticket_number?: string | null;
    unique_index?: number | null;
    project_id?: number | null;
  }
) {
  const { task_id, ticket_number, unique_index, project_id } = options;

  const orConditions: any[] = [];

  if (task_id && !isNaN(Number(task_id))) {
    orConditions.push({ id: task_id });
  }

  if (ticket_number && typeof ticket_number === "string" && ticket_number.length > 0) {
    const ticketCondition: any = { ticketNumber: ticket_number };
    if (project_id) {
      ticketCondition.projectId = project_id;
    }
    orConditions.push(ticketCondition);
  }

  if (
    unique_index != null &&
    unique_index !== undefined &&
    project_id != null &&
    project_id !== undefined
  ) {
    orConditions.push({
      projectId: project_id,
      uniqueIndex: unique_index,
    });
  }

  if (orConditions.length === 0) return null;

  const tasks = await prisma.task.findMany({
    where: {
      OR: orConditions,
      status: ACTIVE_TASK_MUTATION_STATUS,
      project: getProjectWhere(user.id, agentId),
    },
    select: { id: true, projectId: true },
    take: 1,
  });

  return tasks[0] ?? null;
}

export async function POST(request: NextRequest) {
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

    let body: AssignBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
        },
        { status: 400 }
      );
    }

    const { task_id, ticket_number, project_id, unique_index, user_id, user_ids, mode, intent, assign_self, agent_id } =
      body;
    const assignIntent = intent ?? "assign";
    if (assignIntent !== "assign" && assignIntent !== "unassign") {
      return NextResponse.json(
        { success: false, error: 'intent must be "assign" or "unassign"' },
        { status: 400 }
      );
    }

    // Validate task identification
    const taskIdCount = [!!task_id, !!ticket_number, !!unique_index].filter(Boolean).length;
    if (taskIdCount === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Either task_id, ticket_number, or (project_id + unique_index) must be provided",
        },
        { status: 400 }
      );
    }
    if (taskIdCount > 1) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Cannot provide multiple task identification methods. Use one of: task_id, ticket_number, or (project_id + unique_index)",
        },
        { status: 400 }
      );
    }
    if (unique_index != null && !project_id) {
      return NextResponse.json(
        {
          success: false,
          error: "project_id is required when using unique_index",
        },
        { status: 400 }
      );
    }

    // Validate user identification
    const hasSingleUser = user_id != null && !isNaN(Number(user_id));
    const hasMultipleUsers = Array.isArray(user_ids) && user_ids.length > 0 && mode === "multiple";

    const hasAgentId = typeof agent_id === "string" && agent_id.trim().length > 0;

    if (!assign_self && !hasAgentId && !hasSingleUser && !hasMultipleUsers) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Either user_id, (user_ids + mode: 'multiple'), agent_id, or assign_self must be provided. For multiple users, mode must be 'multiple'.",
        },
        { status: 400 }
      );
    }
    if (hasSingleUser && hasMultipleUsers) {
      return NextResponse.json(
        {
          success: false,
          error: "Provide either user_id or user_ids, not both",
        },
        { status: 400 }
      );
    }
    if (user_ids && user_ids.length > 0 && mode !== "multiple") {
      return NextResponse.json(
        {
          success: false,
          error: "mode: 'multiple' is required when using user_ids",
        },
        { status: 400 }
      );
    }

    const task = await findTaskByIdentifier(user, ctx.agentId, {
      task_id: task_id ?? null,
      ticket_number: ticket_number ?? null,
      unique_index: unique_index ?? null,
      project_id: project_id ?? null,
    });

    if (!task) {
      return NextResponse.json(
        {
          success: false,
          error: "Task not found or access denied",
        },
        { status: 404 }
      );
    }

    const userObj = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        photoURL: true,
      },
    });

    if (!userObj) {
      return NextResponse.json(
        {
          success: false,
          error: "User not found",
        },
        { status: 404 }
      );
    }

    const currentUser: IUser = {
      id: userObj.id,
      email: userObj.email ?? "",
      displayName: userObj.displayName ?? undefined,
      photoURL: userObj.photoURL ?? undefined,
      uid: "",
      stripe_customer_id: "",
      joinedAt: new Date(),
      UserSettingId: "",
      UserSetting: {} as any,
    };

    let lastAssignStatus = "Assigned";
    let assignmentOutcome: "created" | "already-assigned" =
      "already-assigned";
    const recordAssignmentResult = (result: AssignmentResult) => {
      lastAssignStatus = result.assignStatus;
      if (result.assignmentOutcome === "created") {
        assignmentOutcome = "created";
      }
    };

    if (assign_self) {
      // Agent self-assignment: add the calling agent itself as an assignee.
      // The controller records agentId on the row and validates board membership.
      if (!ctx.agentId) {
        return NextResponse.json(
          { success: false, error: "assign_self requires an agent token" },
          { status: 400 }
        );
      }
      const response = await assigneesAssign(
        currentUser,
        currentUser.id,
        task.id,
        ctx.agentId,
        ctx.agentId,
        { intent: assignIntent }
      );
      if (response.status !== 200) {
        return NextResponse.json(
          {
            success: false,
            error: (response.json as { message?: string }).message ?? "Assign/unassign failed",
          },
          { status: response.status }
        );
      }
      recordAssignmentResult(response.json as AssignmentResult);
    } else if (hasAgentId) {
      // Owner acting on one of their own agents. This is the only way to remove
      // a revoked agent, whose token is gone so it cannot unassign itself.
      const targetAgentId = (agent_id as string).trim();
      const ownedAgent = await prisma.agent.findFirst({
        where: { id: targetAgentId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!ownedAgent) {
        return NextResponse.json(
          { success: false, error: "Agent not found or not owned by you" },
          { status: 404 }
        );
      }
      const response = await assigneesAssign(
        currentUser,
        currentUser.id,
        task.id,
        targetAgentId,
        ctx.agentId ?? undefined,
        { intent: assignIntent }
      );
      if (response.status !== 200) {
        return NextResponse.json(
          {
            success: false,
            error: (response.json as { message?: string }).message ?? "Assign/unassign failed",
          },
          { status: response.status }
        );
      }
      recordAssignmentResult(response.json as AssignmentResult);
    } else {
      const userIdsToProcess = hasMultipleUsers
        ? (user_ids as number[]).filter((id) => id != null && !isNaN(Number(id)))
        : [user_id as number];

      if (userIdsToProcess.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "No valid user_id(s) provided",
          },
          { status: 400 }
        );
      }

      // Validate all users are members of the task's project (owner or project member).
      // Removals skip this: someone who has left the board must still be
      // removable, or their chip is stuck on the task forever (HTPR-4187).
      const allowedMemberIds =
        assignIntent === "unassign" ? [] : await getMemberAndOwner(task.projectId);
      if (typeof allowedMemberIds === "string") {
        return NextResponse.json(
          {
            success: false,
            error: "Could not resolve project members",
          },
          { status: 500 }
        );
      }
      const allowedSet = new Set(allowedMemberIds);
      const invalidUserIds =
        assignIntent === "unassign"
          ? []
          : userIdsToProcess.filter((uid) => !allowedSet.has(uid));
      if (invalidUserIds.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `User(s) ${invalidUserIds.join(", ")} are not members of this project. Only project owner and members can be assigned.`,
            details: { field: "user_id", code: "not_project_member", invalidIds: invalidUserIds },
          },
          { status: 400 }
        );
      }

      for (const uid of userIdsToProcess) {
        //Right now we are only assigning users from agents
        const response = await assigneesAssign(currentUser, uid, task.id, undefined, ctx.agentId ?? undefined, {
          intent: assignIntent,
        });
        if (response.status !== 200) {
          return NextResponse.json(
            {
              success: false,
              error: (response.json as { message?: string }).message ?? "Assign/unassign failed",
            },
            { status: response.status }
          );
        }
        const result = response.json as AssignmentResult;
        recordAssignmentResult(result);
      }
    }

    const assignStatus = lastAssignStatus;

    const assigneeRows = await prisma.assignees.findMany({
      where: { taskId: task.id },
      select: {
        userId: true,
        agent: { select: mcpAgentSelect },
        agentAssigner: { select: mcpAgentSelect },
      },
    });

    const assignees: McpAssigneeResponseItem[] = assigneeRows.map((row) => {
      const item: McpAssigneeResponseItem = { userId: row.userId };
      const agent = mapMcpAgent(row.agent);
      const agentAssigner = mapMcpAgent(row.agentAssigner);
      if (agent) item.agent = agent;
      if (agentAssigner) item.agentAssigner = agentAssigner;
      return item;
    });

    const sessionAgent = await getMcpSessionAgentSummary(ctx.agentId, user.id);

    void broadcastBoardChange(task.projectId, { originUserId: user.id });

    return NextResponse.json(
      {
        success: true,
        assignees,
        assignStatus,
        ...(assignIntent === "assign" && !hasMultipleUsers
          ? { assignmentOutcome }
          : {}),
        ...(sessionAgent ? { agent: sessionAgent } : {}),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[MCP Assign] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
