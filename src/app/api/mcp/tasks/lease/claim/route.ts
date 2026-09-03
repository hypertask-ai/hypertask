import { NextRequest, NextResponse } from 'next/server';
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth';
import prisma from '@/lib/prisma';
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask';
import {
  canManageLease,
  clampLeaseTtlSeconds,
  isValidTaskId,
} from '@/lib/mcp/tasks/lease';
import { lockAgentMutationFence } from '@/lib/mcp/tasks/agentMutationFence';

type LeaseRow = {
  taskId: number;
  holder: number;
  agentId: string | null;
  expiresAt: Date;
  heartbeatAt: Date;
};

export async function POST(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized. Invalid or missing authentication token.',
      },
      { status: 401 }
    );
  }
  if (!ctx.agentId) {
    return NextResponse.json(
      { success: false, error: 'Task mutation leases require an agent token' },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Request body must be valid JSON' },
      { status: 400 }
    );
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, error: 'Request body must be a JSON object' },
      { status: 400 }
    );
  }

  const {
    task_id,
    ttl_seconds,
    require_assignment,
    require_unassigned,
    require_no_agent_assignment,
  } = body as {
    task_id?: unknown;
    ttl_seconds?: unknown;
    require_assignment?: unknown;
    require_unassigned?: unknown;
    require_no_agent_assignment?: unknown;
  };
  if (!isValidTaskId(task_id)) {
    return NextResponse.json(
      { success: false, error: 'task_id must be a positive integer' },
      { status: 400 }
    );
  }
  if (
    ttl_seconds !== undefined &&
    (typeof ttl_seconds !== 'number' || !Number.isFinite(ttl_seconds))
  ) {
    return NextResponse.json(
      { success: false, error: 'ttl_seconds must be a finite number' },
      { status: 400 }
    );
  }
  if (
    (require_assignment !== undefined && typeof require_assignment !== 'boolean') ||
    (require_unassigned !== undefined && typeof require_unassigned !== 'boolean') ||
    (require_no_agent_assignment !== undefined &&
      typeof require_no_agent_assignment !== 'boolean')
  ) {
    return NextResponse.json(
      { success: false, error: 'assignment preconditions must be booleans' },
      { status: 400 }
    );
  }
  if (
    [require_assignment, require_unassigned, require_no_agent_assignment].filter(Boolean)
      .length > 1
  ) {
    return NextResponse.json(
      { success: false, error: 'assignment preconditions are mutually exclusive' },
      { status: 400 }
    );
  }
  const task = await findTaskByIdentifier(
    ctx.user,
    { task_id },
    ctx.agentId
  );
  if (!task) {
    return NextResponse.json(
      { success: false, error: 'Task not found or access denied' },
      { status: 404 }
    );
  }

  const ttlSeconds = clampLeaseTtlSeconds(ttl_seconds as number | undefined);

  try {
    const leases = await prisma.$transaction(async (tx) => {
      await lockAgentMutationFence(tx, task.id);

      const liveTask = await tx.task.findUnique({
        where: { id: task.id },
        select: { status: true },
      });
      // Archived tasks may still be leased so an agent can restore them to
      // Normal; only deletion closes the lifecycle for good.
      if (!liveTask || liveTask.status === 'Deleted') return [];

      if (require_assignment) {
        const assignments = await tx.assignees.findMany({
          where: { taskId: task.id, agentId: { not: null } },
          select: { agentId: true },
        });
        if (
          !assignments.some(({ agentId }) => agentId === ctx.agentId) ||
          assignments.some(({ agentId }) => agentId !== ctx.agentId)
        ) return [];
      }
      if (require_unassigned) {
        const assignment = await tx.assignees.findFirst({
          where: { taskId: task.id },
          select: { id: true },
        });
        if (assignment) return [];
      }
      if (require_no_agent_assignment) {
        const agentAssignment = await tx.assignees.findFirst({
          where: { taskId: task.id, agentId: { not: null } },
          select: { id: true },
        });
        if (agentAssignment) return [];
      }

      return tx.$queryRaw<LeaseRow[]>`
        INSERT INTO "TaskLease" ("taskId", "holder", "agentId", "expiresAt", "heartbeatAt")
        VALUES (${task.id}, ${ctx.user.id}, ${ctx.agentId}, now() + (${ttlSeconds} * INTERVAL '1 second'), now())
        ON CONFLICT ("taskId") DO UPDATE SET
          "holder" = EXCLUDED."holder",
          "agentId" = EXCLUDED."agentId",
          -- An explicit claim never inherits adopted-lease ownership state.
          "token" = NULL,
          "adoptionCount" = 0,
          "adoptionRefs" = ARRAY[]::TEXT[],
          "expiresAt" = EXCLUDED."expiresAt",
          "heartbeatAt" = EXCLUDED."heartbeatAt"
        WHERE "TaskLease"."expiresAt" <= now()
        RETURNING "taskId", "holder", "agentId", "expiresAt", "heartbeatAt"
      `;
    });

    if (leases.length === 0) {
      const liveTask = await prisma.task.findUnique({
        where: { id: task.id },
        select: { status: true },
      });
      if (!liveTask || liveTask.status === 'Deleted') {
        return NextResponse.json(
          {
            success: false,
            error: 'Task lifecycle precondition failed',
            message: 'Deleted tasks cannot acquire an agent mutation lease.',
          },
          { status: 409 }
        );
      }
      if (require_assignment || require_unassigned || require_no_agent_assignment) {
        const assignments = await prisma.assignees.findMany({
          where: {
            taskId: task.id,
            ...(require_unassigned ? {} : { agentId: { not: null } }),
          },
          select: { agentId: true },
        });
        const preconditionFailed = require_assignment
          ? !assignments.some(({ agentId }) => agentId === ctx.agentId) ||
            assignments.some(({ agentId }) => agentId !== ctx.agentId)
          : assignments.length > 0;
        if (preconditionFailed) {
          return NextResponse.json(
            {
              success: false,
              error: 'Assignment precondition failed',
              message: require_assignment
                ? 'The calling agent is no longer the task\'s exclusive agent assignee.'
                : require_unassigned
                  ? 'The task already has an assignee.'
                  : 'Another agent already owns the task.',
            },
            { status: 409 }
          );
        }
      }
      const conflictingLeases = await prisma.$queryRaw<Array<{ holder: number; agentId: string | null }>>`
        SELECT "holder", "agentId"
        FROM "TaskLease"
        WHERE "taskId" = ${task.id} AND "expiresAt" > now()
      `;
      const conflictingLease = conflictingLeases[0];

      return NextResponse.json(
        {
          success: false,
          error: 'Lease conflict',
          message: 'Task already has an active lease.',
          lease: {
            held: true,
            holder: conflictingLease && canManageLease(
              conflictingLease.holder,
              conflictingLease.agentId,
              ctx.user.id,
              ctx.agentId
            ) ? 'current_user' : 'another_user',
            agentId: conflictingLease?.agentId ?? null,
          },
        },
        { status: 409 }
      );
    }

    const lease = leases[0];
    return NextResponse.json(
      {
        success: true,
        lease: {
          taskId: lease.taskId,
          holder: lease.holder,
          agentId: lease.agentId,
          expiresAt: lease.expiresAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[MCP Task Lease Claim] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to claim task lease' },
      { status: 500 }
    );
  }
}
