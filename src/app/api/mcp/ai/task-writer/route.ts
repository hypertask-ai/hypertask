import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit } from '@/lib/mcp/routeWrapper'
import { reportError } from "@/lib/errors/reportError";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createUnauthorizedResponse } from '@/lib/mcp/auth'
import { errorMessage } from "@/app/api/ai/_lib/editorAi";
import {
  AiFeatureDisabledError,
  ProjectAccessError,
  taskWriterRequestSchema,
} from "@/app/api/ai/_lib/taskWriterRun";
import { generateTaskWriterDraft } from "@/app/api/ai/_lib/taskWriterDraft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
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
    const draft = await generateTaskWriterDraft(body, userId, ctx.agentId);
    if (!draft.success) {
      return NextResponse.json(
        { success: false, error: draft.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      html: draft.html,
      ...(draft.labelIds ? { labelIds: draft.labelIds } : {}),
      ...(draft.customFields?.length ? { customFields: draft.customFields } : {}),
      title: draft.title,
      priority: draft.priority,
      estimate: draft.estimate,
      mode: input.mode,
      model: draft.model,
      provider: draft.provider,
      skills: draft.skills,
    });
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return NextResponse.json(
        { success: false, error: "Permission error", message: error.message },
        { status: 403 }
      );
    }
    if (
      error instanceof AiFeatureDisabledError ||
      (error instanceof Error &&
        (error.name === "AiGatewayKeyRequiredError" ||
          error.name === "AiPlanAccessError"))
    ) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 }
      );
    }
    await reportError({
      message: error instanceof Error ? error.message : "AI request failed",
      stack: error instanceof Error ? error.stack : undefined,
      url: "/api/mcp/ai/task-writer",
      source: "handled",
      extra: { stage: "request" },
    });
    console.error("[mcp/ai/task-writer] error", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }

  })(request)
}
