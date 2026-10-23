import { downloadWithoutBrotli } from "@/lib/net/downloadWithoutBrotli";
import { applyTaskWriterDueDate, validateTaskWriterDueDate } from "@/lib/ai/taskWriterDueDate";
import { normalizeTaskWriterTicketType, readTaskWriterTicketType, ticketTypeSafeCut, TICKET_TYPE_HEADER } from "@/lib/ai/taskWriterTicketType";
import { reportError as reportErrorToBoard } from "@/lib/errors/reportError";
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
import { normalizeTaskWriterLabels, validateTaskWriterLabelIds, extractTaskWriterProperties, hasUsableTaskWriterDraft, TASK_WRITER_EMPTY_DRAFT_MESSAGE } from "@/app/api/ai/_lib/taskWriterProperties";
import {
  AiFeatureDisabledError,
  AutoDescriptionSuggestionsDisabledError,
  ProjectAccessError,
  missingRequiredFields,
  prepareTaskWriterRun,
  taskWriterRequestSchema,
  type TaskWriterRequest,
} from "@/app/api/ai/_lib/taskWriterRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isRealErrorEnabled(userId: number) {
  const { HTPR_7077_TASK_WRITER_REAL_ERROR_FLAG, isFeatureEnabled } = await import("@/lib/flags");
  return isFeatureEnabled(HTPR_7077_TASK_WRITER_REAL_ERROR_FLAG, userId);
}

async function isAllowanceLimitMessage(message: string) {
  if (!message.includes("AI allowance")) return false;
  const { SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE } = await import("@/lib/aiAllowancePolicy");
  return message === SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE;
}

async function logTaskWriterFailure(label: string, error: unknown) {
  if (await isAllowanceLimitMessage(errorMessage(error))) {
    console.warn(`[ai/task-writer] refused: included AI allowance used up (${label})`);
    return true;
  }
  console.error(`[ai/task-writer] ${label}`, error);
  return false;
}

export async function POST(request: NextRequest) {
  const requestUser = await getAiRequestUser(request);
  if (!requestUser?.id) {
    return createSseErrorResponse("Unauthorized", 401);
  }
  const userId = requestUser.id;
  const reportError = async (payload: Parameters<typeof reportErrorToBoard>[0]) => {
    if (await isAllowanceLimitMessage(payload.message)) {
      const { HTPR_7086_SKIP_ALLOWANCE_REPORT_FLAG, isFeatureEnabled } = await import("@/lib/flags");
      if (await isFeatureEnabled(HTPR_7086_SKIP_ALLOWANCE_REPORT_FLAG, userId)) return;
    }
    await reportErrorToBoard(payload);
  };

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

    const { selected, instructions, messages, allowedImgSrcs, usageTaskId, splitTasks, validateDraft, dueDateContext, ticketTypeEnabled, customFieldDefinitions, tasksSchema, boardLabelIds, skills, composeSkillsEnabled } =
      await prepareTaskWriterRun(body, userId);
    let skillsHeader: string | undefined;
    if (composeSkillsEnabled && skills.length) {
      const { HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG, isFeatureEnabled } = await import("@/lib/flags");
      if (await isFeatureEnabled(HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG, userId)) {
        const { encodeTaskWriterSkills } = await import("@/lib/ai/taskWriterSkills");
        skillsHeader = encodeTaskWriterSkills(skills.map(({ id, slug, name, updatedAt }) => ({
          id, slug, name, updatedAt: updatedAt.toISOString(),
        })));
      }
    }
    const typeHeaders: Record<string, string> = {
      ...(skillsHeader ? { "X-Task-Writer-Skills": skillsHeader } : {}),
      ...(ticketTypeEnabled ? { [TICKET_TYPE_HEADER]: "enabled" } : {}),
      ...(boardLabelIds ? { "X-Task-Writer-Labels": "enabled" } : {}),
    };
    if (splitTasks) {
      configureAiModelUsage(selected.model, {
        userId, teamId: selected.teamId, projectId: body.projectId,
        taskId: usageTaskId, provider: selected.usageProvider, feature: "task-writer",
      });
      const result = await generateText({
        experimental_download: downloadWithoutBrotli,
        model: selected.model, instructions, messages, tools: selected.tools,
        maxRetries: 2, providerOptions: selected.providerOptions, ...selected.settings,
        output: Output.object({ schema: tasksSchema }),
      });
      const fieldTools = customFieldDefinitions?.length ? await import("@/lib/ai/taskWriterCustomFields") : null;
      const { tasks } = tasksSchema.parse({ tasks: result.output.tasks.slice(0, 10) });
      return NextResponse.json({ tasks: tasks.map(({ dueDate: modelDueDate, ...draft }) => {
        const { customFields: modelCustomFields, labelIds: modelLabelIds, ...task } = draft as typeof draft & { customFields?: unknown; labelIds?: unknown };
        const customFields = customFieldDefinitions?.length
          ? fieldTools!.validateTaskWriterCustomFields(customFieldDefinitions, modelCustomFields) : [];
        const fieldValues = { ...(customFields.length ? { customFields } : {}), ...(boardLabelIds ? { labelIds: validateTaskWriterLabelIds(modelLabelIds, boardLabelIds) } : {}) };
        const filtered = allowedImgSrcs ? filterOneImagePass(task.description, allowedImgSrcs).emit : task.description;
        const description = ticketTypeEnabled ? normalizeTaskWriterTicketType(filtered) : filtered;
        if (!dueDateContext) return { ...task, description, ...fieldValues };
        const dueDate = validateTaskWriterDueDate(modelDueDate, dueDateContext.today);
        return { ...task, description, ...fieldValues, ...(dueDate ? { dueDate } : {}) };
      }) }, dueDateContext || ticketTypeEnabled || boardLabelIds || skillsHeader
        ? { headers: { ...(dueDateContext ? { "X-Task-Writer-Due-Date": "enabled" } : {}), ...typeHeaders } }
        : undefined);
    }
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = "";
        let draft = "";
        let streamCompleted = false;
        let streamError: unknown;
        let producedText = false;

        let held = "";
        const enqueueText = (text: string) => {
          if (validateDraft || dueDateContext || ticketTypeEnabled || boardLabelIds) draft += text;
          if (!text || dueDateContext || boardLabelIds) return;
          if (!ticketTypeEnabled) {
            controller.enqueue(encoder.encode(text));
            return;
          }
          held += text;
          const cut = ticketTypeSafeCut(held);
          if (cut > 0) controller.enqueue(encoder.encode(held.slice(0, cut)));
          held = held.slice(cut);
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
            experimental_download: downloadWithoutBrotli,
            model: selected.model,
            instructions,
            messages,
            tools: selected.tools,
            maxRetries: 2,
            providerOptions: selected.providerOptions,
            ...selected.settings,
            onError: ({ error }: { error: unknown }) => {
              streamError ??= error;
            },
          });

          for await (const chunk of result.textStream) {
            if (!chunk) continue;
            producedText = true;
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
          if (!producedText && streamError !== undefined && await isRealErrorEnabled(userId)) {
            const error = streamError;
            await reportError({
              message: error instanceof Error ? error.message : "AI request failed",
              stack: error instanceof Error ? error.stack : undefined,
              url: "/api/ai/task-writer",
              source: "handled",
              extra: { stage: "stream-empty" },
            });
            await logTaskWriterFailure("stream ended empty after error", error);
            enqueueError("error", errorMessage(error), "task-writer-stream-error");
            return;
          }
          const description = validateDraft && body.aiMode === "AiTaskWriter"
            ? extractTaskWriterProperties(ticketTypeEnabled ? readTaskWriterTicketType(draft).html : draft).description
            : draft;
          if (validateDraft && !hasUsableTaskWriterDraft(description)) {
            enqueueError("error", TASK_WRITER_EMPTY_DRAFT_MESSAGE, "empty-task-writer-draft");
            return;
          }
          if (dueDateContext || boardLabelIds) {
            const labeled = boardLabelIds ? normalizeTaskWriterLabels(draft, boardLabelIds) : draft;
            const dated = dueDateContext ? applyTaskWriterDueDate(labeled, dueDateContext).html : labeled;
            controller.enqueue(encoder.encode(ticketTypeEnabled ? normalizeTaskWriterTicketType(dated) : dated));
          } else if (ticketTypeEnabled && held) {
            controller.enqueue(encoder.encode(normalizeTaskWriterTicketType(held)));
          }
          streamCompleted = true;
        } catch (error) {
          await reportError({
            message: error instanceof Error ? error.message : "AI request failed",
            stack: error instanceof Error ? error.stack : undefined,
            url: "/api/ai/task-writer",
            source: "handled",
            extra: { stage: "stream" },
          });
          await logTaskWriterFailure("stream error", error);
          enqueueError("error", errorMessage(error));
        } finally {
          if (!streamCompleted) {
          }
          controller.close();
        }
      },
      cancel() {
      },
    });

    const headers = dueDateContext || ticketTypeEnabled || boardLabelIds || skillsHeader
      ? { ...SSE_HEADERS, ...(dueDateContext ? { "X-Task-Writer-Due-Date": "enabled" } : {}), ...typeHeaders }
      : SSE_HEADERS;
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
    const allowanceUsedUp = await logTaskWriterFailure("fatal error", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: allowanceUsedUp ? 429 : 500 });
  }
}
