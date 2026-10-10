import { applyTaskWriterDueDate, validateTaskWriterDueDate } from "@/lib/ai/taskWriterDueDate";
import { reportError } from "@/lib/errors/reportError";
import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { NextRequest, NextResponse } from "next/server";
import { generateText, Output, streamText } from "ai";

import {
  createSseErrorResponse,
  errorMessage,
  filterOneImagePass,
  sseFrame,
  SSE_HEADERS,
} from "@/app/api/ai/_lib/editorAi";
import { getAiRequestUser } from "@/app/api/ai/_lib/requestUser";
import { extractTaskWriterProperties, hasUsableTaskWriterDraft, TASK_WRITER_EMPTY_DRAFT_MESSAGE } from "@/app/api/ai/_lib/taskWriterProperties";
import {
  AiFeatureDisabledError,
  AutoDescriptionSuggestionsDisabledError,
  ProjectAccessError,
  missingRequiredFields,
  prepareTaskWriterRun,
  taskWriterRequestSchema,
  tasksOutputSchema,
  type TaskWriterRequest,
} from "@/app/api/ai/_lib/taskWriterRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestUser = await getAiRequestUser(request);
  if (!requestUser?.id) {
    return createSseErrorResponse("Unauthorized", 401);
  }
  const userId = requestUser.id;

  let body: TaskWriterRequest;
  try {
    body = taskWriterRequestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: `Invalid request: ${errorMessage(error)}` },
      { status: 400 }
    );
  }

  try {
    if (missingRequiredFields(body)) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const { selected, instructions, messages, allowedImgSrcs, usageTaskId, splitTasks, validateDraft, dueDateContext } =
      await prepareTaskWriterRun(body, userId);
    if (splitTasks) {
      configureAiModelUsage(selected.model, {
        userId, teamId: selected.teamId, projectId: body.projectId,
        taskId: usageTaskId, provider: selected.usageProvider, feature: "task-writer",
      });
      const result = await generateText({
        model: selected.model, instructions, messages, tools: selected.tools,
        maxRetries: 2, providerOptions: selected.providerOptions, ...selected.settings,
        output: Output.object({ schema: tasksOutputSchema }),
      });
      const { tasks } = tasksOutputSchema.parse({ tasks: result.output.tasks.slice(0, 10) });
      return NextResponse.json({ tasks: tasks.map(({ dueDate: modelDueDate, ...task }) => {
        const description = allowedImgSrcs ? filterOneImagePass(task.description, allowedImgSrcs).emit : task.description;
        if (!dueDateContext) return { ...task, description };
        const dueDate = validateTaskWriterDueDate(modelDueDate, dueDateContext.today);
        return { ...task, description, ...(dueDate ? { dueDate } : {}) };
      }) }, dueDateContext ? { headers: { "X-Task-Writer-Due-Date": "enabled" } } : undefined);
    }
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = "";
        let draft = "";
        let streamCompleted = false;

        const enqueueText = (text: string) => {
          if (validateDraft || dueDateContext) draft += text;
          // Compose consumes completed HTML, so a due-date request is validated before it is sent.
          if (text && !dueDateContext) controller.enqueue(encoder.encode(text));
        };
        const enqueueError = (status: "error" | "interrupted", content: string, code?: string) => {
          controller.enqueue(
            encoder.encode(
              sseFrame("error", { type: "error", content, ...(code ? { code } : {}) }) +
                sseFrame("done", { status })
            )
          );
        };

        try {
          configureAiModelUsage(selected.model, {
            userId,
            teamId: selected.teamId,
            projectId: body.projectId,
            taskId: usageTaskId,
            provider: selected.usageProvider,
            feature: "task-writer",
          });
          const result = streamText({
            model: selected.model,
            instructions,
            messages,
            tools: selected.tools,
            maxRetries: 2,
            providerOptions: selected.providerOptions,
            ...selected.settings,
          });

          for await (const chunk of result.textStream) {
            if (!chunk) continue;
            if (allowedImgSrcs) {
              buffer += chunk;
              const filtered = filterOneImagePass(buffer, allowedImgSrcs);
              buffer = filtered.leftover;
              enqueueText(filtered.emit);
            } else {
              enqueueText(chunk);
            }
          }

          if (allowedImgSrcs && buffer) {
            const filtered = filterOneImagePass(buffer, allowedImgSrcs);
            enqueueText(filtered.emit);
          }
          const description = validateDraft && body.aiMode === "AiTaskWriter"
            ? extractTaskWriterProperties(draft).description
            : draft;
          if (validateDraft && !hasUsableTaskWriterDraft(description)) {
            enqueueError("error", TASK_WRITER_EMPTY_DRAFT_MESSAGE, "empty-task-writer-draft");
            return;
          }
          if (dueDateContext) controller.enqueue(encoder.encode(applyTaskWriterDueDate(draft, dueDateContext).html));
          streamCompleted = true;
        } catch (error) {
          await reportError({
            message: error instanceof Error ? error.message : "AI request failed",
            stack: error instanceof Error ? error.stack : undefined,
            url: "/api/ai/task-writer",
            source: "handled",
            extra: { stage: "stream" },
          });
          console.error("[ai/task-writer] stream error", error);
          enqueueError("error", errorMessage(error));
        } finally {
          if (!streamCompleted) {
            // Flask only sends done on error/interruption; successful streams end raw.
          }
          controller.close();
        }
      },
      cancel() {
        // Client disconnects are expected for cancelled generations.
      },
    });

    const headers = dueDateContext ? { ...SSE_HEADERS, "X-Task-Writer-Due-Date": "enabled" } : SSE_HEADERS;
    return new Response(stream, { headers });
  } catch (error) {
    if (
      error instanceof AiFeatureDisabledError ||
      error instanceof AutoDescriptionSuggestionsDisabledError ||
      error instanceof ProjectAccessError ||
      (error instanceof Error &&
        (error.name === "AiGatewayKeyRequiredError" ||
          error.name === "AiPlanAccessError"))
    ) {
      return createSseErrorResponse(error.message, 403);
    }
    await reportError({
      message: error instanceof Error ? error.message : "AI request failed",
      stack: error instanceof Error ? error.stack : undefined,
      url: "/api/ai/task-writer",
      source: "handled",
      extra: { stage: "request" },
    });
    console.error("[ai/task-writer] fatal error", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
