import { NextRequest, NextResponse } from 'next/server';
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth';
import prisma from '@/lib/prisma';
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask';
import {
  clampLeaseTtlSeconds,
  isValidLeaseToken,
  isValidTaskId,
} from '@/lib/mcp/tasks/lease';

type LeaseRow = {
  taskId: number;
  holder: number;
  agentId: string | null;
  token: string | null;
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

  const { task_id, ttl_seconds, lease_token } = body as {
    task_id?: unknown;
    ttl_seconds?: unknown;
    lease_token?: unknown;
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
  if (lease_token !== undefined && !isValidLeaseToken(lease_token)) {
    return NextResponse.json(
      { success: false, error: 'lease_token must be a UUID' },
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
  const leaseToken = lease_token ?? null;

  try {
    const leases = await prisma.$queryRaw<LeaseRow[]>`
      UPDATE "TaskLease"
      SET
        "expiresAt" = now() + (${ttlSeconds} * INTERVAL '1 second'),
        "heartbeatAt" = now()
      WHERE "taskId" = ${task.id}
        AND "holder" = ${ctx.user.id}
        AND (${ctx.agentId}::text IS NULL OR "agentId" = ${ctx.agentId})
        AND (${ctx.agentId}::text IS NULL OR "token" IS NOT DISTINCT FROM ${leaseToken})
        AND "expiresAt" > now()
      RETURNING "taskId", "holder", "agentId", "token", "expiresAt", "heartbeatAt"
    `;

    if (leases.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Lease not found, expired, or held by another user',
        },
        { status: 404 }
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
          leaseToken: lease.token,
          expiresAt: lease.expiresAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[MCP Task Lease Heartbeat] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to heartbeat task lease' },
      { status: 500 }
    );
  }
}
