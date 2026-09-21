import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import {
  saveAgentRuntimeSnapshot,
} from "@/lib/agents/runtimeState";
import {
  acceptAgentRuntimeHeartbeat,
  RuntimeHeartbeatError,
} from "@/lib/agents/runtimeHeartbeat";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx?.agentId || !ctx.agentRuntimeGeneration) {
    return NextResponse.json(
      { success: false, error: "A managed agent token is required" },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  try {
    const snapshot = await acceptAgentRuntimeHeartbeat({
      agentId: ctx.agentId,
      userId: ctx.user.id,
      authenticatedGeneration: ctx.agentRuntimeGeneration,
      projectWhere: getProjectWhere(ctx.user.id),
      body,
      db: prisma,
      save: saveAgentRuntimeSnapshot,
    });
    return NextResponse.json({
      success: true,
      heartbeat_at: snapshot.heartbeatAt,
    });
  } catch (error) {
    if (error instanceof RuntimeHeartbeatError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          ...(error.resetSequence
            ? { reset_sequence: error.resetSequence }
            : {}),
        },
        { status: error.status },
      );
    }
    console.error("[Agent runtime] Heartbeat failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to record runtime heartbeat" },
      { status: 500 },
    );
  }
}
