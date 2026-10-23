import { requireAgentWriteRole } from "@/lib/mcp/agents/readRoleGuard";
import { recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { projectContentAccessWhere, taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { NextRequest } from "next/server";
import { parse } from "node-html-parser";
import { noStore } from "@/lib/flags/http";
import {
  FEATURE_FLAG_MODES,
  FEATURE_FLAG_OWNER_USER_ID,
  FeatureFlagInputError,
  FeatureFlagApprovalError,
  defaultFeatureFlagMode,
  isFeatureEnabled,
  isFeatureFlagOwnerUserId,
  listFeatureFlagModes,
  setFeatureFlagMode,
  type FeatureFlagMode,
} from "@/lib/flags";
import { RELEASE_WATCH, isReleaseWatchSpike } from "@/lib/flags/releaseWatch.mjs";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import { HTPR_7364_BATCH_FLAG_APPROVAL_FLAG } from "@/lib/flags/definitions/htpr-7364-batch-flag-approval";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";
import { broadcastFeatureFlagsChange } from "@/lib/realtime/server";
import { reportError } from "@/lib/errors/reportError";

const APPROVAL_REQUIRED_MESSAGE = "Valentin must thumbs-up that comment within 7 days, the comment must be unedited, and the whole comment must be: Question: Switch <flag-key> to <mode>?";
const MODE_APPROVAL_WORDS: Record<FeatureFlagMode, string> = {
  OWNER_ONLY: "Only me",
  OWNER_AND_QA: "Owner + QA",
  EVERYONE: "Everyone",
  OFF: "Off",
};
const SWITCH_REQUEST = /^(?:@?Valentin Yeo )?Question: Switch ([a-z0-9]+(?:-[a-z0-9]+)*) to (Only me|Owner \+ QA|Everyone|Off)\?$/;
const BATCH_SWITCH_REQUEST = /^(?:@?Valentin Yeo )?Question:((?:\s*Switch [a-z0-9]+(?:-[a-z0-9]+)* to (?:Only me|Owner \+ QA|Everyone|Off)\?)+)$/;
const BATCH_SWITCH_ITEM = /Switch ([a-z0-9]+(?:-[a-z0-9]+)*) to (Only me|Owner \+ QA|Everyone|Off)\?/g;

function approvedSwitches(words: string, batchAllowed: boolean): Map<string, string> | null {
  const text = words.replace(/\s+/g, " ").trim();
  const single = SWITCH_REQUEST.exec(text);
  if (single) return new Map([[single[1], single[2]]]);
  const batch = batchAllowed ? BATCH_SWITCH_REQUEST.exec(text) : null;
  if (!batch) return null;
  const switches = new Map<string, string>();
  for (const [, key, mode] of batch[1].matchAll(BATCH_SWITCH_ITEM)) {
    if (switches.has(key)) return null;
    switches.set(key, mode);
  }
  return switches;
}

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
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const ctx = await authorize(request);
    if (ctx instanceof Response) return ctx;
    const flags = await listFeatureFlagModes({ includeTicketTitles: true, includeLastChange: true, principal: { userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope } });
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

  })(request)
}

export async function PATCH(request: NextRequest) {
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
    const body = JSON.parse(text) as { key?: unknown; mode?: unknown; reason?: unknown; watch?: { before?: unknown; after?: unknown; windowMinutes?: unknown; releasedAt?: unknown } } | null;
    if (!body || Array.isArray(body) || typeof body.key !== "string"
      || typeof body.mode !== "string" || !FEATURE_FLAG_MODES.includes(body.mode as FeatureFlagMode)) {
      return noStore({ error: "Invalid feature flag" }, 400);
    }
    const link = typeof body.reason === "string" && body.reason.length <= 500
      ? /^https:\/\/app\.hypertask\.ai\/detail\/project-([1-9]\d{0,8})\/([1-9]\d{0,8})#comment-([1-9]\d{0,8})$/.exec(body.reason)
      : null;
    const ticket = /^htpr-([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(body.key);
    const watch = body.watch;
    const releaseTime = typeof watch?.releasedAt === "string" ? Date.parse(watch.releasedAt) : NaN;
    const releaseAge = Date.now() - releaseTime;
    const watchAgentId = process.env.FLAG_RELEASE_WATCH_AGENT_ID;
    const watchRequested = watchAgentId && ctx.agentId === watchAgentId && body.mode === "OFF" && ticket
      && body.reason === `https://app.hypertask.ai/detail/project-15/${ticket[1]}`
      && watch && Number.isSafeInteger(watch.windowMinutes)
      && Number(watch.windowMinutes) >= RELEASE_WATCH.minimumMinutes
      && Number(watch.windowMinutes) <= RELEASE_WATCH.watchMinutes
      && releaseAge >= RELEASE_WATCH.minimumMinutes * 60_000
      && releaseAge <= RELEASE_WATCH.maximumMinutes * 60_000
      && releaseAge >= Number(watch.windowMinutes) * 60_000
      && releaseAge < (Number(watch.windowMinutes) + 2) * 60_000
      && isReleaseWatchSpike(watch.before, watch.after);
    if (!link && !watchRequested) {
      return noStore({ error: "Reason must link to the approved ticket comment (#comment-<id>)" }, 400);
    }
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: ctx.agentId as string },
      select: { displayName: true },
    });
    const batchAllowed = await isFeatureEnabled(HTPR_7364_BATCH_FLAG_APPROVAL_FLAG, ctx.user.id);
    const watchTask = watchRequested && ticket ? await prisma.task.findFirst({
      where: { projectId: 15, uniqueIndex: Number(ticket[1]), status: { not: "Deleted" }, project: taskWriteAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope) },
      select: { id: true, userId: true },
    }) : null;
    if (watchRequested && !watchTask) throw new FeatureFlagApprovalError("Release watch ticket is not writable");
    let watched = false;
    const actor = {
      userId: ctx.user.id,
      agentId: ctx.agentId as string,
      agentName: agent.displayName,
      reason: body.reason as string,
      source: "api" as const,
    };
    const flag = await setFeatureFlagMode(body.key, body.mode as FeatureFlagMode, actor, async (tx) => {
      if (watchRequested) {
        const stored = await tx.featureFlag.findUnique({ where: { key: body.key as string }, select: { mode: true, releasedAt: true } });
        const age = stored?.releasedAt ? Date.now() - stored.releasedAt.getTime() : NaN;
        if (stored?.mode === "EVERYONE" && stored.releasedAt?.getTime() === releaseTime
          && age >= RELEASE_WATCH.minimumMinutes * 60_000
          && age <= RELEASE_WATCH.maximumMinutes * 60_000) {
          watched = true;
          actor.reason = `release watch: errors ${watch!.before} -> ${watch!.after} in ${watch!.windowMinutes} min; ${body.reason}`;
          return;
        }
      }
      if (!link) throw new FeatureFlagApprovalError("Release watch is not eligible; Valentin's thumbs-up is required");
      const commentId = Number(link[3]);
      const approval = await tx.comment.findFirst({
        where: { id: commentId, task: { projectId: Number(link[1]), uniqueIndex: Number(link[2]), status: { not: "Deleted" }, project: projectContentAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope) } },
        select: { taskId: true },
      });
      if (!approval) throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
      recordAgentBoardScopeMiss(Number(link[1]), "write");
      const locked = await tx.$queryRaw<Array<{ id: number }>>`SELECT c.id FROM "Comment" c JOIN "Task" t ON t.id = c."taskId" WHERE c.id = ${commentId} AND t.id = ${approval.taskId} AND t."projectId" = ${Number(link[1])} FOR UPDATE`;
      if (!locked.length) throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
      await tx.$queryRaw`SELECT id FROM "Reaction" WHERE "commentId" = ${commentId} FOR UPDATE`;
      const comment = await tx.comment.findFirst({
        where: {
          id: commentId,
          editedAt: null,
          task: { projectId: Number(link[1]), uniqueIndex: Number(link[2]), status: { not: "Deleted" }, project: projectContentAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope) },
          reactions: { some: {
            userId: FEATURE_FLAG_OWNER_USER_ID, agentId: null, agentDisplayName: null, isDeleted: false,
            unified: { startsWith: "1f44d" },
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          } },
        },
        select: { commentText: true, text: true },
      });
      const words = parse(comment?.text || comment?.commentText || "").text;
      const switches = comment ? approvedSwitches(words, batchAllowed) : null;
      if (!switches || switches.get(body.key as string) !== MODE_APPROVAL_WORDS[body.mode as FeatureFlagMode]) {
        throw new FeatureFlagApprovalError(
          APPROVAL_REQUIRED_MESSAGE,
        );
      }
    });
    const previousMode = flag.lastChange
      ? flag.lastChange.oldMode ?? defaultFeatureFlagMode(body.key)
      : flag.mode;
    await broadcastFeatureFlagsChange().catch((error) =>
      console.warn("[feature-flags] realtime broadcast failed", error),
    );
    let notified = false;
    if (watched && watchTask) {
      try {
        const currentUser = await prisma.user.findUniqueOrThrow({
          where: { id: ctx.user.id }, select: { id: true, email: true, displayName: true, photoURL: true },
        });
        await createCommentService({
          text: `<p><strong>Switched ${body.key} Off: production errors jumped after it went live.</strong></p>`
            + `<p>Errors: ${watch!.before} before / ${watch!.after} after, each over ${watch!.windowMinutes} minutes.</p>`
            + `<p>Next: fix the cause, then ask Valentin to switch it back on. <span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span></p>`,
          creatorId: ctx.user.id, agentId: ctx.agentId as string, teamScope: ctx.teamScope,
          taskId: watchTask.id, ownerId: watchTask.userId, currentUser,
        });
        notified = true;
      } catch (error) {
        await reportError({
          message: `Release watch switched ${body.key} Off but failed to notify Valentin`,
          source: "server",
          url: body.reason as string,
          stack: error instanceof Error ? error.stack : undefined,
          extra: { flagKey: body.key, agentId: ctx.agentId as string },
        }).catch((reportingError) => console.error("[feature-flags] release watch notification reporting failed", reportingError));
      }
    }
    return noStore({ flag, previousMode, ...(watched ? { notified } : {}) });
  } catch (error) {
    if (error instanceof FeatureFlagApprovalError) {
      return noStore({ error: error.message }, 403);
    }
    if (error instanceof SyntaxError || error instanceof FeatureFlagInputError) {
      return noStore(
        { error: error instanceof FeatureFlagInputError ? error.message : "Invalid JSON" },
        400,
      );
    }
    console.error("[feature-flags] MCP update failed", error);
    return noStore({ error: "Unable to update feature flag" }, 500);
  }

  })(request)
}
