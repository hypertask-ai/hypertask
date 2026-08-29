import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";

import {
  validateMcpAuth,
  checkMcpRateLimit,
  createUnauthorizedResponse,
} from "@/lib/mcp/auth";
import { errorMessage, filterOneImagePass } from "@/app/api/ai/_lib/editorAi";
import {
  AiFeatureDisabledError,
  ProjectAccessError,
  prepareTaskWriterRun,
  taskWriterRequestSchema,
} from "@/app/api/ai/_lib/taskWriterRun";
import { extractTaskWriterProperties } from "@/app/api/ai/_lib/taskWriterProperties";
import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel default is 10s; a task-writer run with retrieval routinely needs more.
export const maxDuration = 300;

// Same harness as the in-app AI Task Writer / Write with AI (the browser hits
// src/app/api/ai/task-writer/route.ts and shares prepareTaskWriterRun), but
// authenticated with the MCP bearer token and answered as one JSON blob instead
// of an SSE stream, so the hypertask CLI and MCP tools can call it.
// `/slug` skill invocation works here exactly as it does in the UI: put the
// token in the prompt and the resolver injects that skill's body.
// .strict() on purpose: this endpoint has no attachment fields yet, and silently
// stripping an images64/pdfs64 payload would run the request without the file the
// caller was asking about. Better to reject the unknown key.
const requestSchema = z
  .object({
    project_id: z.coerce.number().int().positive(),
    prompt: z.string().min(1),
    mode: z.enum(["task_writer", "write_with_ai"]).default("task_writer"),
    task_ids: z.array(z.coerce.number().int()).optional().default([]),
    task_title: z.string().optional().default(""),
    task_description: z.string().optional().default(""),
    custom_instructions: z.string().optional().default(""),
  })
  .strict();
// No model param on purpose: selectTaskWriterModel derives the model from the
// team's AI settings and the caller's personal per-feature preference, exactly
// as it does for the in-app writer. A request-level override would silently
// diverge from what the same user gets in the UI.

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
    const body = taskWriterRequestSchema.parse({
      projectId: input.project_id,
      PROMPT: input.prompt,
      aiMode: input.mode === "task_writer" ? "AiTaskWriter" : "WriteWithAI",
      taskIds: input.task_ids,
      taskTitle: input.task_title,
      taskDescription: input.task_description,
      customInstructions: input.custom_instructions,
    });
    const {
      selected,
      instructions,
      messages,
      allowedImgSrcs,
      skills,
      usageTaskId,
    } = await prepareTaskWriterRun(body, userId, ctx.agentId);

    const { text, usage } = await generateText({
      model: selected.model,
      instructions,
      messages,
      tools: selected.tools,
      maxRetries: 2,
      providerOptions: selected.providerOptions,
      ...selected.settings,
    });
    await logAiUsage({
      userId,
      teamId: selected.teamId,
      projectId: body.projectId,
      taskId: usageTaskId,
      agentId: ctx.agentId,
      provider: selected.usageProvider,
      model: selected.modelId,
      feature: "task-writer",
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
    });

    // The streaming route filters invented <img> tags chunk by chunk; one pass
    // over the finished text is the same filter for a non-streamed response.
    const filtered = allowedImgSrcs
      ? filterOneImagePass(text, allowedImgSrcs).emit
      : text;
    // Task-writer output carries the title/priority/size markers the UI pulls
    // out when you accept a response. Split them here so a CLI caller can write
    // the same fields instead of pasting the markers into the description.
    // Write-with-AI output is plain comment HTML and has no markers.
    const properties =
      input.mode === "task_writer"
        ? extractTaskWriterProperties(filtered)
        : { title: null, description: filtered };

    return NextResponse.json({
      success: true,
      html: properties.description,
      title: properties.title,
      priority: "priority" in properties ? properties.priority : undefined,
      estimate: "estimate" in properties ? properties.estimate : undefined,
      mode: input.mode,
      model: selected.modelId,
      provider: selected.usageProvider,
      skills: skills.map((skill) => ({ slug: skill.slug, name: skill.name })),
    });
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return NextResponse.json(
        { success: false, error: "Permission error", message: error.message },
        { status: 403 }
      );
    }
    if (error instanceof AiFeatureDisabledError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 }
      );
    }
    console.error("[mcp/ai/task-writer] error", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
