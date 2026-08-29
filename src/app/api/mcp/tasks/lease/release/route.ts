import { NextRequest, NextResponse } from 'next/server';
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth';
import prisma from '@/lib/prisma';
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask';
import { isValidTaskId } from '@/lib/mcp/tasks/lease';

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

  const { task_id } = body as { task_id?: unknown };
  if (!isValidTaskId(task_id)) {
    return NextResponse.json(
      { success: false, error: 'task_id must be a positive integer' },
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

  try {
    const deleted = await prisma.$executeRaw`
      DELETE FROM "TaskLease"
      WHERE "taskId" = ${task.id}
        AND "holder" = ${ctx.user.id}
        AND (${ctx.agentId}::text IS NULL OR "agentId" = ${ctx.agentId})
        AND "expiresAt" > now()
    `;

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
    console.error('[MCP Task Lease Release] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to release task lease' },
      { status: 500 }
    );
  }
}
