import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";

import {
  createSseErrorResponse,
  errorMessage,
  filterOneImagePass,
  sseFrame,
  SSE_HEADERS,
} from "@/app/api/ai/_lib/editorAi";
import { getAiRequestUser } from "@/app/api/ai/_lib/requestUser";
import {
  AiFeatureDisabledError,
  AutoDescriptionSuggestionsDisabledError,
  ProjectAccessError,
  missingRequiredFields,
  prepareTaskWriterRun,
  taskWriterRequestSchema,
  type TaskWriterRequest,
} from "@/app/api/ai/_lib/taskWriterRun";
import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";

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

    const { selected, instructions, messages, allowedImgSrcs, usageTaskId } =
      await prepareTaskWriterRun(body, userId);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = "";
        let streamCompleted = false;

        const enqueueText = (text: string) => {
          if (text) controller.enqueue(encoder.encode(text));
        };
        const enqueueError = (status: "error" | "interrupted", content: string) => {
          controller.enqueue(
            encoder.encode(
              sseFrame("error", { type: "error", content }) +
                sseFrame("done", { status })
            )
          );
        };

        try {
          const result = streamText({
            model: selected.model,
            instructions,
            messages,
            tools: selected.tools,
            maxRetries: 2,
            onFinish: async ({ usage }) => {
              await logAiUsage({
                userId,
                teamId: selected.teamId,
                projectId: body.projectId,
                taskId: usageTaskId,
                provider: selected.usageProvider,
                model: selected.modelId,
                feature: "task-writer",
                inputTokens: usage.inputTokens ?? 0,
                outputTokens: usage.outputTokens ?? 0,
                totalTokens: usage.totalTokens ?? 0,
              });
            },
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
          streamCompleted = true;
        } catch (error) {
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

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    if (
      error instanceof AiFeatureDisabledError ||
      error instanceof AutoDescriptionSuggestionsDisabledError ||
      error instanceof ProjectAccessError
    ) {
      return createSseErrorResponse(error.message, 403);
    }
    console.error("[ai/task-writer] fatal error", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
