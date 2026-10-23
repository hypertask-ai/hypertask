import { NextRequest } from "next/server";
import { authorize } from "@/lib/flags/agentAuthorization";
import { FEATURE_FLAG_KEYS, RETIRED_FEATURE_FLAG_KEYS, validFeatureFlagKey } from "@/lib/flags";
import { noStore } from "@/lib/flags/http";
import { requireAgentWriteRole } from "@/lib/mcp/agents/readRoleGuard";
import { wrapMcpRoute } from "@/lib/mcp/routeWrapper";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    if (text.length > 2048) return noStore({ error: "Request is too large" }, 413);
    const body = JSON.parse(text) as {
      key?: unknown; mode?: unknown; aiReviewUrl?: unknown;
      independentReview?: unknown; liveQaUrl?: unknown; inboxCycle?: unknown;
    } | null;
    if (!body || Array.isArray(body) || typeof body.key !== "string" || !validFeatureFlagKey(body.key)) {
      return noStore({ error: "Invalid feature flag" }, 400);
    }
    if (body.mode !== "EVERYONE") return noStore({ error: "Reviews are only allowed for Everyone" }, 403);
    if (typeof body.independentReview !== "string" || !body.independentReview.trim()
      || body.independentReview.length > 300 || body.inboxCycle !== "passed") {
      return noStore({ error: "Independent review (1-300 characters) and passed inbox cycle are required" }, 400);
    }
    for (const url of [body.aiReviewUrl, body.liveQaUrl]) {
      if (typeof url !== "string" || url.length > 300 || !URL.canParse(url) || new URL(url).protocol !== "https:") {
        return noStore({ error: "Review evidence must use https URLs (max 300 characters)" }, 400);
      }
    }
    if (!/^https:\/\/github\.com\/hypertask-ai\/hypertask\/pull\/[1-9]\d*$/.test(body.aiReviewUrl as string)) {
      return noStore({ error: "AI review must link to https://github.com/hypertask-ai/hypertask/pull/<n>" }, 400);
    }
    if (RETIRED_FEATURE_FLAG_KEYS.has(body.key) || (!(FEATURE_FLAG_KEYS as readonly string[]).includes(body.key)
      && !await prisma.featureFlag.findUnique({ where: { key: body.key }, select: { key: true } }))) {
      return noStore({ error: "Unknown feature flag" }, 400);
    }
    const review = await prisma.featureFlagReview.create({
      data: {
        key: body.key,
        mode: "EVERYONE",
        reviewerUserId: ctx.user.id,
        reviewerAgentId: ctx.agentId as string,
        aiReviewUrl: body.aiReviewUrl as string,
        independentReview: body.independentReview,
        liveQaUrl: body.liveQaUrl as string,
        inboxCyclePassed: true,
        deployedSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      },
    });
    return noStore({ review }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "Invalid JSON" }, 400);
    console.error("[feature-flags] MCP review failed", error);
    return noStore({ error: "Unable to record feature flag review" }, 500);
  }

  })(request)
}
