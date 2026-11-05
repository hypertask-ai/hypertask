import { getAgentRole, insufficientScopeResponse, roleMeets } from "@/lib/mcp/agents/scopes";
import { recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { parse } from "node-html-parser";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { classifyAnswer, FLAG_CHAT_RECORD_AGENT_ID, isOffOrder, normalizeVisibleText, parseSwitchQuestion, strictSwitchRequest } from "@/lib/flags/approvalWords";
import { noStore } from "@/lib/flags/http";
import {
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_MODES,
  FEATURE_FLAG_OWNER_USER_ID,
  FeatureFlagInputError,
  FeatureFlagApprovalError,
  defaultFeatureFlagMode,
  isFeatureEnabled,
  listFeatureFlagModes,
  setFeatureFlagMode,
  type FeatureFlagMode,
} from "@/lib/flags";
import { HTPR_7727_PLAIN_YES_FLAG_APPROVAL_FLAG } from "@/lib/flags/definitions/htpr-7727-plain-yes-flag-approval";
import { HTPR_8339_TEMPLATE_SWITCH_QUESTION_FLAG } from "@/lib/flags/definitions/htpr-8339-template-switch-question";
import { authorize } from "@/lib/flags/agentAuthorization";
import { lockCommentReactions } from "@/lib/mcp/comments/reactionLock";
import prisma from "@/lib/prisma";
import { broadcastFeatureFlagsChange } from "@/lib/realtime/server";

const APPROVAL_REQUIRED_MESSAGE = "Needs a clear yes from Valentin within 7 days: his thumbs up on the switch question, his own comment on the ticket after exactly one switch question, or HT Product Lead's in-chat record of his exact words. Questions name the switch: Switch <flag-key> to <mode>";
const MODE_APPROVAL_WORDS: Record<FeatureFlagMode, string> = {
  OWNER_ONLY: "Only me",
  OWNER_AND_QA: "Owner + QA",
  EVERYONE: "Everyone",
  OFF: "Off",
};
const ownerRequestSchema = z.object({
  source: z.string(),
  quote: z.string().max(1000).refine((quote) => !!normalizeVisibleText(quote)),
  requestedAt: z.string().datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/),
}).strict();
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const role = ctx.agentRole ?? await getAgentRole(ctx);
    if (!roleMeets(role, "write")) {
      const refusal = insufficientScopeResponse(role, "write");
      refusal.headers.set("Cache-Control", "private, no-store");
      return refusal;
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return noStore({ error: "Content-Type must be application/json" }, 415);
    }
    const text = await request.text();
    if (text.length > 4096) return noStore({ error: "Request is too large" }, 413);
    const body = JSON.parse(text) as { key?: unknown; mode?: unknown; reason?: unknown; review?: unknown; failure?: unknown; ownerRequest?: unknown } | null;
    if (!body || Array.isArray(body) || typeof body.key !== "string"
      || typeof body.mode !== "string" || !FEATURE_FLAG_MODES.includes(body.mode as FeatureFlagMode)) {
      return noStore({ error: "Invalid feature flag" }, 400);
    }
    const evidenceKinds = ["reason", "review", "failure", "ownerRequest"].filter((field) => Object.hasOwn(body, field));
    if (evidenceKinds.length > 1) {
      return noStore({ error: "Provide only one evidence type" }, 400);
    }
    const usesReview = evidenceKinds[0] === "review";
    const usesFailure = evidenceKinds[0] === "failure";
    if (usesReview) throw new FeatureFlagApprovalError("Review receipts cannot authorize a flag switch");
    const parsedAttestation = body.ownerRequest === undefined ? undefined : ownerRequestSchema.safeParse(body.ownerRequest);
    if (parsedAttestation && !parsedAttestation.success) {
      return noStore({ error: "Invalid ownerRequest" }, 400);
    }
    const attestation = parsedAttestation?.data;
    if (usesFailure) {
      if (typeof body.failure !== "string" || !body.failure.trim() || body.failure.length > 300) {
        return noStore({ error: "Failure must be a nonblank reason or URL (max 300 characters)" }, 400);
      }
      if (body.mode !== "OWNER_AND_QA") {
        throw new FeatureFlagApprovalError("A failure record can only hold a flag at Owner + QA");
      }
    }
    const source = attestation ? attestation.source : body.reason;
    const link = typeof source === "string" && source.length <= 500
      ? /^https:\/\/app\.hypertask\.ai\/detail\/project-([1-9]\d{0,8})\/([1-9]\d{0,8})#comment-([1-9]\d{0,8})$/.exec(source)
      : null;
    if (!usesReview && !usesFailure && !link) {
      return noStore({ error: "Reason must link to the approved ticket comment (#comment-<id>)" }, 400);
    }
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: ctx.agentId as string },
      select: { displayName: true },
    });
    const flag = await setFeatureFlagMode(body.key, body.mode as FeatureFlagMode, {
      userId: ctx.user.id,
      agentId: ctx.agentId as string,
      agentName: agent.displayName,
      reason: usesFailure ? `live-qa-failed:${body.failure}` : source as string,
      source: "api",
    }, async (tx) => {
      if (usesFailure) {
        const stored = await tx.featureFlag.findUnique({ where: { key: body.key as string }, select: { mode: true } });
        if (!stored && !(FEATURE_FLAG_KEYS as readonly string[]).includes(body.key as string)) return;
        const current = stored?.mode ?? defaultFeatureFlagMode(body.key as string);
        if (current === body.mode) {
          throw new FeatureFlagApprovalError("Flag is already in that mode");
        }
        if (current !== "EVERYONE") {
          throw new FeatureFlagApprovalError("A failure hold only narrows a flag that is on for everyone");
        }
        return;
      }
      if (!link) throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
      const commentId = Number(link[3]);
      const approval = await tx.comment.findFirst({
        where: { id: commentId, task: { projectId: Number(link[1]), uniqueIndex: Number(link[2]), status: { not: "Deleted" }, project: projectContentAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope) } },
        select: { taskId: true },
      });
      if (!approval) throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
      recordAgentBoardScopeMiss(Number(link[1]), "write");
      await lockCommentReactions(tx, commentId);
      const locked = await tx.$queryRaw<Array<{ id: number }>>`SELECT c.id FROM "Comment" c JOIN "Task" t ON t.id = c."taskId" WHERE c.id = ${commentId} AND t.id = ${approval.taskId} AND t."projectId" = ${Number(link[1])} FOR UPDATE`;
      if (!locked.length) throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
      await tx.$queryRaw`SELECT id FROM "Reaction" WHERE "commentId" = ${commentId} FOR UPDATE`;
      const now = Date.now();
      const week = 7 * 24 * 60 * 60 * 1000;
      const commentSelect = {
        id: true, text: true, commentText: true, creatorId: true, agentId: true,
        agentDisplayName: true, editedAt: true, editedByUserId: true, editedByAgentId: true,
        createdAt: true, taskId: true,
      } as const;
      const comment = await tx.comment.findFirst({
        where: {
          id: commentId,
          editedAt: null,
          task: { projectId: Number(link[1]), uniqueIndex: Number(link[2]), status: { not: "Deleted" }, project: projectContentAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope) },
        },
        select: {
          ...commentSelect,
          reactions: { where: {
            userId: FEATURE_FLAG_OWNER_USER_ID, agentId: null, agentDisplayName: null, isDeleted: false,
            unified: { startsWith: "1f44d" },
            createdAt: { gte: new Date(now - week) },
          }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
      if (!comment) throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
      const words = normalizeVisibleText(comment.text || comment.commentText || "");
      const unedited = comment.editedAt === null && comment.editedByUserId === null && comment.editedByAgentId === null;
      const human = unedited && comment.creatorId === FEATURE_FLAG_OWNER_USER_ID
        && comment.agentId === null && comment.agentDisplayName === null;
      if (attestation) {
        const lead = await tx.agent.findUnique({
          where: { id: FLAG_CHAT_RECORD_AGENT_ID }, select: { userId: true, revokedAt: true },
        });
        const trustedSource = unedited && comment.creatorId === FEATURE_FLAG_OWNER_USER_ID
          && comment.agentId === FLAG_CHAT_RECORD_AGENT_ID;
        const requestedAt = new Date(attestation.requestedAt);
        if (ctx.agentId !== FLAG_CHAT_RECORD_AGENT_ID || !lead || lead.userId !== FEATURE_FLAG_OWNER_USER_ID
          || lead.revokedAt !== null || (!human && !trustedSource)
          || requestedAt.getTime() > now || requestedAt > comment.createdAt
          || (human && requestedAt.getTime() !== comment.createdAt.getTime())
          || !words.includes(normalizeVisibleText(attestation.quote))) {
          throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
        }
        const latest = await tx.featureFlagChange.findFirst({
          where: { key: body.key as string, createdAt: { gt: requestedAt } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { newMode: true },
        });
        if (latest && latest.newMode !== body.mode) {
          throw new FeatureFlagApprovalError("A later flag change supersedes this request");
        }
        const laterComments = await tx.comment.findMany({
          where: { taskId: comment.taskId, creatorId: FEATURE_FLAG_OWNER_USER_ID, agentId: null,
            agentDisplayName: null, createdAt: { gte: requestedAt } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: commentSelect,
        });
        const withdrawal = laterComments.find((later) => later.id !== comment.id
          && classifyAnswer(normalizeVisibleText(later.text || later.commentText || "")) === "no");
        if (withdrawal) throw new FeatureFlagApprovalError(`Valentin said no after that approval (comment ${withdrawal.id})`);
        await tx.logs.create({ data: { type: "Board", status: "Normal", LoggedById: ctx.user.id,
          log: JSON.stringify({ event: "flag_owner_request", key: body.key, mode: body.mode,
            agentId: ctx.agentId, source, requestedAt: requestedAt.toISOString(),
            quoteSha256: createHash("sha256").update(attestation.quote).digest("hex") }) } });
        return;
      }
      const plainYesAllowed = await isFeatureEnabled(HTPR_7727_PLAIN_YES_FLAG_APPROVAL_FLAG, ctx.user.id);
      const templateQuestionAllowed = await isFeatureEnabled(HTPR_8339_TEMPLATE_SWITCH_QUESTION_FLAG, ctx.user.id);
      const answer = classifyAnswer(words);
      if (human && answer === "no") {
        throw new FeatureFlagApprovalError(`Valentin said no on comment ${comment.id}; no switch`);
      }
      let switches = plainYesAllowed ? parseSwitchQuestion(words, templateQuestionAllowed)
        : strictSwitchRequest(parse(comment.text || comment.commentText || "").text, true, templateQuestionAllowed);
      let kind: "thumbs-up" | "ticket-yes" | "chat-record";
      let questionCommentIds = [comment.id];
      let approvedAt = comment.createdAt;
      if (unedited && comment.reactions.length && switches) {
        kind = "thumbs-up";
        approvedAt = comment.reactions[0].createdAt;
      } else {
        if (!plainYesAllowed) throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
        const fresh = comment.createdAt.getTime() >= now - week;
        if (human && fresh && answer === "yes") {
          kind = "ticket-yes";
        } else {
          const record = /^(?:@(?:valentin yeo|ht product lead)\b[\s,:-]*)?valentin said in chat \((\d{4}-\d{2}-\d{2})\):\s*"([^"]*)"(?:(?:[\s\p{P}]+switch\s+[a-z0-9]+(?:-[a-z0-9]+)*\s+to\s+(?:only\s+me|owner\s*\+\s*qa|everyone|off)(?![\w-]))+[\s\p{P}]*|\.)?$/u.exec(words);
          const recordDate = record ? Date.parse(`${record[1]}T00:00:00.000Z`) : NaN;
          if (!unedited || !fresh || comment.creatorId !== FEATURE_FLAG_OWNER_USER_ID
            || comment.agentId !== FLAG_CHAT_RECORD_AGENT_ID || !record || !Number.isFinite(recordDate)
            || new Date(recordDate).toISOString().slice(0, 10) !== record[1]
            || recordDate > now || recordDate < now - week
            || (words.match(/"/g) ?? []).length !== 2 || (classifyAnswer(record[2]) !== "yes" && !(body.mode === "OFF" && isOffOrder(record[2])))) {
            throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
          }
          const lead = await tx.agent.findUnique({
            where: { id: FLAG_CHAT_RECORD_AGENT_ID }, select: { userId: true, revokedAt: true },
          });
          if (!lead || lead.userId !== FEATURE_FLAG_OWNER_USER_ID || lead.revokedAt !== null) {
            throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
          }
          kind = "chat-record";
          approvedAt = new Date(recordDate);
        }
        if (kind !== "chat-record" || !switches) {
          const beforeApproval = { OR: [
            { createdAt: { lt: comment.createdAt } },
            { createdAt: comment.createdAt, id: { lt: comment.id } },
          ] };
          const previous = await tx.comment.findFirst({
            where: {
              taskId: comment.taskId, creatorId: FEATURE_FLAG_OWNER_USER_ID, agentId: null, agentDisplayName: null,
              ...beforeApproval,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, createdAt: true },
          });
          const window = {
            taskId: comment.taskId,
            createdAt: { gte: new Date(comment.createdAt.getTime() - week) },
            ...beforeApproval,
            ...(previous ? { AND: [{ OR: [
              { createdAt: { gt: previous.createdAt } },
              { createdAt: previous.createdAt, id: { gt: previous.id } },
            ] }] } : {}),
          };
          const candidates = (await tx.comment.findMany({
            where: window, orderBy: { id: "asc" }, select: commentSelect,
          })).filter((candidate) => parseSwitchQuestion(normalizeVisibleText(candidate.text || candidate.commentText || ""), templateQuestionAllowed));
          for (const candidate of candidates) {
            await tx.$queryRaw`SELECT id FROM "Comment" WHERE id = ${candidate.id} ORDER BY id FOR UPDATE`;
          }
          const questions = (await tx.comment.findMany({
            where: { ...window, id: { in: candidates.map((candidate) => candidate.id) } },
            orderBy: { id: "asc" }, select: commentSelect,
          })).filter((candidate) => parseSwitchQuestion(normalizeVisibleText(candidate.text || candidate.commentText || ""), templateQuestionAllowed));
          if (questions.length !== 1) {
            throw new FeatureFlagApprovalError("Ambiguous or missing question: Valentin's yes must follow exactly one switch question; ask him to thumbs-up the one he means");
          }
          const question = questions[0];
          if (question.editedAt !== null || question.editedByUserId !== null || question.editedByAgentId !== null) {
            throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
          }
          switches = parseSwitchQuestion(normalizeVisibleText(question.text || question.commentText || ""), templateQuestionAllowed);
          questionCommentIds = [question.id];
        }
      }
      if (!switches || switches.get(body.key as string) !== MODE_APPROVAL_WORDS[body.mode as FeatureFlagMode]) {
        throw new FeatureFlagApprovalError(APPROVAL_REQUIRED_MESSAGE);
      }
      const laterComments = await tx.comment.findMany({
        where: {
          taskId: comment.taskId, creatorId: FEATURE_FLAG_OWNER_USER_ID, agentId: null, agentDisplayName: null,
          ...(kind === "chat-record" ? { createdAt: { gte: approvedAt } }
            : kind === "thumbs-up" ? { createdAt: { gt: approvedAt } } : { OR: [
            { createdAt: { gt: approvedAt } },
            { createdAt: approvedAt, id: { gt: comment.id } },
          ] }),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: commentSelect,
      });
      const withdrawal = laterComments.find((later) => classifyAnswer(normalizeVisibleText(later.text || later.commentText || "")) === "no");
      if (withdrawal) {
        throw new FeatureFlagApprovalError(`Valentin said no after that approval (comment ${withdrawal.id})`);
      }
      console.info("[feature-flags] approval", JSON.stringify({
        key: body.key, mode: body.mode, kind, approvalCommentId: comment.id,
        questionCommentIds, verdict: "yes", classifier: "v1",
      }));
    });
    const previousMode = flag.lastChange
      ? flag.lastChange.oldMode ?? defaultFeatureFlagMode(body.key)
      : flag.mode;
    await broadcastFeatureFlagsChange().catch((error) =>
      console.warn("[feature-flags] realtime broadcast failed", error),
    );
    return noStore({ flag, previousMode });
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
