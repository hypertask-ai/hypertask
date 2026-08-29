import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";

import { requestSchema } from "@/app/api/mcp/ai/improve/schema";
import {
  validateMcpAuth,
  checkMcpRateLimit,
  createUnauthorizedResponse,
} from "@/lib/mcp/auth";
import {
  createPromptForTiptapForwardSlash,
  errorMessage,
  extractHtmlBlocks,
  normalizeTiptapOutput,
  reattachHtmlBlocks,
  selectTiptapModel,
} from "@/app/api/ai/_lib/editorAi";
import { getProjectTeamProviderContext } from "@/app/api/ai/_lib/providerGate";
import { projectAccessWhere } from "@/app/api/ai/_lib/taskWriterRun";
import { isAiFeatureEnabled } from "@/lib/systemModelLadder";
import { toEditableHtml } from "@/app/api/mcp/ai/improve/plainText";
import prisma from "@/lib/prisma";
import { resolveAiUsageTaskId } from "@/app/api/ai/_lib/currentTaskContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) return createUnauthorizedResponse();
  const userId = ctx.user.id;

  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Invalid request: ${errorMessage(error)}` },
      { status: 400 }
    );
  }

  try {
    // Same authorization gap prepareTaskWriterRun guards against:
    // getProjectTeamProviderContext returns an empty context (no team, no
    // settings) for a project the caller can't see, which would otherwise
    // sail through the feature gate below as "no restrictions configured".
    const project = await prisma.project.findFirst({
      where: {
        id: input.project_id,
        ...projectAccessWhere(userId, ctx.agentId),
      },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found or access denied" },
        { status: 403 }
      );
    }
    const usageTaskId = await resolveAiUsageTaskId({
      taskId: input.task_id,
      projectId: input.project_id,
      userId,
      agentId: ctx.agentId,
    });
    if (input.task_id && usageTaskId === null) {
      return NextResponse.json(
        { success: false, error: "Task not found in this project" },
        { status: 400 },
      );
    }

    const teamContext = await getProjectTeamProviderContext(
      input.project_id,
      userId
    );
    if (!isAiFeatureEnabled("improveWriting", teamContext.settings)) {
      return NextResponse.json(
        { success: false, error: "This AI feature is turned off for your team" },
        { status: 403 }
      );
    }

    const inputHtml = toEditableHtml(input.text);
    // HTML-canvas blocks are opaque to the model and get mangled by an AI
    // edit, same reason the cookie route strips/reattaches them.
    const { stripped, blocks } = extractHtmlBlocks(inputHtml);

    // selectTiptapModel wraps the model with usage-logging middleware
    // (editorUsageMiddleware), so generateText below already calls logAiUsage
    // for us - a second manual call here would double-count tokens.
    const selected = await selectTiptapModel({
      projectId: input.project_id,
      taskId: usageTaskId,
      agentId: ctx.agentId,
      userId,
      teamContext,
    });
    const { text } = await generateText({
      model: selected.model,
      instructions: createPromptForTiptapForwardSlash(input.command, stripped),
      prompt: `Follow the provided instructions for the following content: ${stripped}`,
      maxRetries: 2,
      providerOptions: selected.providerOptions,
      ...selected.settings,
    });

    return NextResponse.json({
      success: true,
      html: reattachHtmlBlocks(normalizeTiptapOutput(stripped, text), blocks),
      command: input.command,
      model: selected.modelId,
    });
  } catch (error) {
    // Log the real error server-side, but never echo raw exception text back
    // to the caller - same as the cookie route (tiptap-forwardslash/route.ts).
    console.error("[mcp/ai/improve] error", errorMessage(error));
    return NextResponse.json(
      { success: false, error: "An internal error occurred. Please try again later." },
      { status: 500 }
    );
  }
}
