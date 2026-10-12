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

// The whole approval comment is "Question: Switch <flag-key> to <mode label>?", optionally after
// the @Valentin Yeo mention, so a negated, quoted or second request never matches.
const MODE_APPROVAL_WORDS: Record<FeatureFlagMode, string> = {
  OWNER_ONLY: "Only me",
  OWNER_AND_QA: "Owner + QA",
  EVERYONE: "Everyone",
  OFF: "Off",
};
const SWITCH_REQUEST = /^(?:@Valentin Yeo )?Question: Switch ([a-z0-9]+(?:-[a-z0-9]+)*) to (Only me|Owner \+ QA|Everyone|Off)\?$/;

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
    // The reason names one comment: the ticket link plus #comment-<id>.
    const link = typeof body.reason === "string" && body.reason.length <= 500
      ? /^https:\/\/app\.hypertask\.ai\/detail\/project-([1-9]\d{0,8})\/([1-9]\d{0,8})#comment-([1-9]\d{0,8})$/.exec(body.reason)
      : null;
    if (!link) {
      return noStore({ error: "Reason must link to the approved ticket comment (#comment-<id>)" }, 400);
    }
    // Approval is Valentin's own thumbs up, within 7 days, on that comment, and the comment names
    // this flag key and the target mode, so a refusal or an unrelated yes never counts.
    const comment = await prisma.comment.findFirst({
      where: {
        id: Number(link[3]),
        task: { projectId: Number(link[1]), uniqueIndex: Number(link[2]), status: { not: "Deleted" } },
        reactions: { some: {
          userId: FEATURE_FLAG_OWNER_USER_ID, agentId: null, agentDisplayName: null, isDeleted: false,
          unified: { startsWith: "1f44d" },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        } },
      },
      select: { commentText: true, text: true },
    });
    const words = comment?.commentText || comment?.text || "";
    const ask = SWITCH_REQUEST.exec(words.replace(/\s+/g, " ").trim());
    if (!comment || !ask || ask[1] !== body.key
      || ask[2] !== MODE_APPROVAL_WORDS[body.mode as FeatureFlagMode]) {
      return noStore({
        error: "Valentin must thumbs-up that comment within 7 days, and the whole comment must be: Question: Switch <flag-key> to <mode>?",
      }, 403);
    }
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: ctx.agentId as string },
      select: { displayName: true },
    });
    const flag = await setFeatureFlagMode(body.key, body.mode as FeatureFlagMode, {
      userId: ctx.user.id,
      agentId: ctx.agentId as string,
      agentName: agent.displayName,
      reason: body.reason as string,
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
