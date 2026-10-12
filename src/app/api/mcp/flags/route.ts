import { NextRequest } from "next/server";
import { noStore } from "@/lib/flags/http";
import {
  FEATURE_FLAG_MODES,
  FEATURE_FLAG_OWNER_USER_ID,
  FeatureFlagInputError,
  defaultFeatureFlagMode,
  isFeatureFlagOwnerUserId,
  listFeatureFlagModes,
  setFeatureFlagMode,
  type FeatureFlagMode,
} from "@/lib/flags";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";
import { broadcastFeatureFlagsChange } from "@/lib/realtime/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authorize(request: NextRequest) {
  const limited = await checkMcpRateLimit(request);
  if (limited) {
    limited.headers.set("Cache-Control", "private, no-store");
    return limited;
  }
  const ctx = await validateMcpAuth(request, { deferManagementPermissionCheck: true });
  if (!ctx) return noStore({ error: "Unauthorized" }, 401);
  if (!ctx.agentId || ctx.management || !(await isFeatureFlagOwnerUserId(ctx.user.id))) {
    return noStore({ error: "Forbidden" }, 403);
  }
  return ctx;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await authorize(request);
    if (ctx instanceof Response) return ctx;
    const flags = await listFeatureFlagModes({ includeTicketTitles: true, includeLastChange: true });
    const key = request.nextUrl.searchParams.get("key");
    if (key !== null) {
      const flag = flags.find((flag) => flag.key === key);
      return flag ? noStore({ flag }) : noStore({ error: "Unknown feature flag" }, 404);
    }
    return noStore({ flags });
  } catch (error) {
    console.error("[feature-flags] MCP read failed", error);
    return noStore({ error: "Unable to load feature flags" }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await authorize(request);
    if (ctx instanceof Response) return ctx;
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return noStore({ error: "Content-Type must be application/json" }, 415);
    }
    const text = await request.text();
    if (text.length > 1024) return noStore({ error: "Request is too large" }, 413);
    const body = JSON.parse(text) as { key?: unknown; mode?: unknown; reason?: unknown } | null;
    if (!body || Array.isArray(body) || typeof body.key !== "string"
      || typeof body.mode !== "string" || !FEATURE_FLAG_MODES.includes(body.mode as FeatureFlagMode)) {
      return noStore({ error: "Invalid feature flag" }, 400);
    }
    const ticket = typeof body.reason === "string" && body.reason.length <= 500
      ? /^https:\/\/app\.hypertask\.ai\/detail\/project-([1-9]\d*)\/([1-9]\d*)(?:[?#].*)?$/.exec(body.reason)
      : null;
    if (typeof body.reason !== "string" || !ticket
      || [ticket[1], ticket[2]].some((value) => Number(value) > 2147483647)) {
      return noStore({ error: "Reason must link to a Hypertask ticket" }, 400);
    }
    const now = new Date();
    const createdAt = { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), lte: now };
    const approved = await prisma.task.findFirst({
      where: {
        projectId: Number(ticket[1]), uniqueIndex: Number(ticket[2]), status: { not: "Deleted" },
        OR: [
          { comments: { some: {
            creatorId: FEATURE_FLAG_OWNER_USER_ID, agentId: null, agentDisplayName: null, createdAt,
          } } },
          { reactions: { some: {
            userId: FEATURE_FLAG_OWNER_USER_ID, agentId: null, agentDisplayName: null,
            isDeleted: false, createdAt, comment: { is: {} },
          } } },
        ],
      },
      select: { id: true },
    });
    if (!approved) {
      return noStore({ error: "Reason must link to a ticket where Valentin approved this in the last 7 days" }, 403);
    }
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: ctx.agentId as string },
      select: { displayName: true },
    });
    const flag = await setFeatureFlagMode(body.key, body.mode as FeatureFlagMode, {
      userId: ctx.user.id,
      agentId: ctx.agentId as string,
      agentName: agent.displayName,
      reason: body.reason,
      source: "api",
    });
    // The locked write supplies the previous mode, not a read that can race another session.
    const previousMode = flag.lastChange
      ? flag.lastChange.oldMode ?? defaultFeatureFlagMode(body.key)
      : flag.mode;
    await broadcastFeatureFlagsChange().catch((error) =>
      console.warn("[feature-flags] realtime broadcast failed", error),
    );
    return noStore({ flag, previousMode });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof FeatureFlagInputError) {
      return noStore(
        { error: error instanceof FeatureFlagInputError ? error.message : "Invalid JSON" },
        400,
      );
    }
    console.error("[feature-flags] MCP update failed", error);
    return noStore({ error: "Unable to update feature flag" }, 500);
  }
}
