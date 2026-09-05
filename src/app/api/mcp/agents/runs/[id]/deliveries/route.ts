import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  agentRunsEnabledFor,
  authenticateAgentRunRequest,
  readAgentRun,
} from "@/lib/agentRuns/service";
import { checkMcpRateLimit } from "@/lib/mcp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lifecycle events an agent handler can be replayed with locally. */
const REPLAYABLE_EVENTS = ["run.created", "run.prompted"];
const MAX_DELIVERIES = 50;

const noStore = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

/**
 * GET /api/mcp/agents/runs/:id/deliveries
 * The webhook messages this run already sent, exact recorded bodies, so
 * `hypertask agent replay` can re-send them to a handler running on a laptop.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;

  try {
    const principal = await authenticateAgentRunRequest(request);
    if (!principal) {
      return noStore(
        { success: false, error: "Invalid or missing authentication" },
        401,
      );
    }
    if (!(await agentRunsEnabledFor(principal))) {
      return noStore({ success: false, error: "Run not found" }, 404);
    }

    const id = (await params).id.trim();
    // Read the run first: it is the access check for this agent or owner.
    const run = id ? await readAgentRun(principal, id) : null;
    if (!run) return noStore({ success: false, error: "Run not found" }, 404);

    const deliveries = await prisma.agentWebhookDelivery.findMany({
      where: {
        subscription: { agentId: run.agentId },
        event: { in: REPLAYABLE_EVENTS },
        payload: { path: ["runId"], equals: run.id },
      },
      orderBy: { createdAt: "asc" },
      take: MAX_DELIVERIES,
      select: { id: true, event: true, createdAt: true, payload: true },
    });

    return noStore({
      success: true,
      runId: run.id,
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        event: delivery.event,
        createdAt: delivery.createdAt.toISOString(),
        payload: delivery.payload,
      })),
    });
  } catch (error) {
    console.error("[agent-run] deliveries read failed", error);
    return noStore(
      { success: false, error: "Failed to read agent run deliveries" },
      500,
    );
  }
}
