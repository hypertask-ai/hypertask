import { lockTaskTeamScope, TaskTeamScopeError } from "@/lib/mcp/tasks/agentMutationFence"
import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server';

import prisma from '@/lib/prisma';
import { findTaskByIdentifier, taskIdentifierErrorResponse } from '@/lib/mcp/tasks/resolveTask';
import { isValidLeaseToken, isValidTaskId } from '@/lib/mcp/tasks/lease';

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
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

  const { task_id, lease_token } = body as {
    task_id?: unknown;
    lease_token?: unknown;
  };
  if (!isValidTaskId(task_id)) {
    return NextResponse.json(
      { success: false, error: 'task_id must be a positive integer' },
      { status: 400 }
    );
  }
  if (lease_token !== undefined && !isValidLeaseToken(lease_token)) {
    return NextResponse.json(
      { success: false, error: 'lease_token must be a UUID' },
      { status: 400 }
    );
  }

  try {
    const task = await findTaskByIdentifier(
      ctx.user,
      { task_id },
      ctx.agentId, undefined, ctx.teamScope
    );
    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found or access denied' },
        { status: 404 }
      );
    }
    const leaseToken = lease_token ?? null;

    const mutate = (tx: import("@prisma/client").Prisma.TransactionClient) => tx.$executeRaw`
      DELETE FROM "TaskLease"
      WHERE "taskId" = ${task.id}
        AND "holder" = ${ctx.user.id}
        AND (${ctx.agentId}::text IS NULL OR "agentId" = ${ctx.agentId})
        AND (${ctx.agentId}::text IS NULL OR "token" IS NOT DISTINCT FROM ${leaseToken})
        AND "expiresAt" > now()
    `;
    const deleted = ctx.teamScope != null ? await prisma.$transaction(async (tx) => {
      await lockTaskTeamScope(tx, task.id, ctx.user.id, ctx.agentId, ctx.teamScope);
      return mutate(tx);
    }) : await mutate(prisma);

    if (deleted === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Lease not found, expired, or held by another user',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        taskId: task.id,
        released: true,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof TaskTeamScopeError) return NextResponse.json({ success: false, error: error.message }, { status: 404 })
    const identifierResponse = taskIdentifierErrorResponse(error);
    if (identifierResponse) return identifierResponse;
    console.error('[MCP Task Lease Release] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to release task lease' },
      { status: 500 }
    );
  }

  })(request)
}
