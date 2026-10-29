import { NextRequest } from "next/server";
import { noStore } from "@/lib/flags/http";
import { requireAgentWriteRole } from "@/lib/mcp/agents/readRoleGuard";
import { authorize } from "@/lib/flags/agentAuthorization";
import { applyManagerLeaseAction, isManagerClassAgentName, ManagerLeaseError, type ManagerLeaseAction } from "@/lib/flags/managerLease";
import { wrapMcpRoute } from "@/lib/mcp/routeWrapper";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS: readonly string[] = ["take", "renew", "release", "handoff"];

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
    try {
      const ctx = await authorize(request);
      if (ctx instanceof Response) return ctx;
      const roleRefusal = await requireAgentWriteRole(ctx);
      if (roleRefusal) return roleRefusal;
      if (!request.headers.get("content-type")?.startsWith("application/json")) {
        return noStore({ error: "Content-Type must be application/json" }, 415);
      }
      const text = await request.text();
      if (text.length > 1024) return noStore({ error: "Request is too large" }, 413);
      const body = JSON.parse(text) as Record<string, unknown> | null;
      if (!body || Array.isArray(body) || typeof body.action !== "string" || !ACTIONS.includes(body.action)) {
        return noStore({ error: "action must be take, renew, release or handoff" }, 400);
      }
      const agent = await prisma.agent.findUniqueOrThrow({ where: { id: ctx.agentId as string }, select: { displayName: true } });
      if (!isManagerClassAgentName(agent.displayName)) {
        return noStore({ error: "Only manager agents register manager leases" }, 403);
      }
      const result = await prisma.$transaction((tx) => applyManagerLeaseAction(tx, {
        agentId: ctx.agentId as string,
        action: body.action as ManagerLeaseAction,
        session: typeof body.session === "string" ? body.session : undefined,
        grantHash: typeof body.grantHash === "string" ? body.grantHash : undefined,
        grant: typeof body.grant === "string" ? body.grant : undefined,
        ttlMinutes: typeof body.ttlMinutes === "number" ? body.ttlMinutes : undefined,
      }));
      return noStore({ ok: true, action: body.action, expiresAt: result.expiresAt?.toISOString() ?? null });
    } catch (error) {
      if (error instanceof ManagerLeaseError) return noStore({ error: error.message }, error.status);
      if (error instanceof SyntaxError) return noStore({ error: "Invalid JSON" }, 400);
      console.error("[manager-leases] registry write failed", error);
      return noStore({ error: "Unable to update manager lease" }, 500);
    }
  })(request);
}
