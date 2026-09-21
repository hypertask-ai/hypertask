import { AuthedUser, COMMENT_TASK_LINK_RULE, ChatRequest, SseEvent, attachmentSchema, errorMessage } from "./buildTools";
import { chatStore } from "@/utils/controllers/chat";
import { generateText, type FilePart, type LanguageModel, type UserContent } from "ai";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { reportError } from "@/lib/errors/reportError";
import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
import { isLiveTaskListRequest } from "./liveTaskList";
import { aiUsageProviderForCredential, isAiGatewayEnabled, isCustomEndpointConfig, providerOptionsForAiModel, resolveAiModel, type AiModelCredential, type AiGatewayTags, type AiProviderOptions } from "@/app/api/ai/_lib/modelProvider";
import { defaultAiModelOption, getAiModelOptionById, type TAiModelOption } from "@/lib/aiModelOptions";
import { filterModelOptionForTeam } from "@/app/api/ai/_lib/providerGate";
import { HOUSE_OUTPUT_STYLE } from "@/app/api/ai/_lib/editorAi";
import { resolveUserFacingModelOption, type UserFacingModelFeature } from "@/lib/systemModelLadder";

export type ProviderId =
  | "claude"
  | "openai"
  | "openrouter"
  | "gateway"
  | "custom";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export const DEFAULT_PROVIDER: ProviderId = "openai";

export const DEFAULT_MODEL = "gpt-5.6-luna";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";

export const MAX_TOOL_STEPS = 32;

export const CLAUDE_MODELS = new Set(["claude-sonnet-5", "claude-opus-5"]);

export const OPENAI_MODELS = new Set([
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "gpt-5.4-mini",
]);

export const CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES = [
  "claude-opus",
  "claude-sonnet-5",
] as const;

export const AGENT_SYSTEM_PROMPT = `
                You are an intelligent and helpful agentic assistant with access to tools and a knowledge base.
                Your goal is to provide helpful, accurate, and relevant responses to user queries.

                ### 0. OUTPUT STYLE (MANDATORY - every response, every model)
                ${HOUSE_OUTPUT_STYLE}
                - Default length cap: at most ~120 words (or ~6 bullets) per answer. Exceed it ONLY when the user explicitly asks for depth ("explain", "in detail", "full", "long") or the deliverable inherently needs it (a full draft or document they requested).
                - Verbose, padded, essay-style answers are failures regardless of which model is running. When in doubt, answer shorter.
                - **Action-first shape**: when the user must do something, give numbered steps in execution order, one bounded action per step. Cap lists at 5 items; split into "do now" vs "later" beyond that.
                - **End with one next action** when anything is left open: something the user can do in under two minutes. Never end with "anything else?".
                - **Concrete estimates**: "about a minute", "half a day"; never "quick" or "some work".
                - Matter-of-fact on errors: state cause and fix. No "Oops", no "Uh oh".

                ### 1. CONTEXT & CHAT HISTORY
                - **Thorough Analysis**: Review the CHAT HISTORY to identify references (e.g., "that task", "X's take").
                - **Conversational Awareness**: Acknowledge the ongoing discussion and use temporal awareness/current time where relevant.
                - **Direct Reference**: Always reference specific past messages or topics rather than stating there is no conversation.
        
                ### 2. HTML FORMATTING RULES
                - **Body Content Only**: Do NOT include <!DOCTYPE html>, <html>, <head>, or <body> tags.
                - **No Styling**: Use basic elements (<p>, <h1>, <h2>, <ul>, <li>). Never apply CSS or inline 'style' attributes.
                - **Task Linking**: Reference tasks by Title. Every task returned by the tools includes a ready-made "url" field (e.g. "/detail/project-339/1365"). Wrap the Title in a link using that url EXACTLY as given: <a href="{{task.url}}">Title</a>. NEVER build the path yourself and NEVER use the task "id" field in a link (that is the global database id, not the ticket number). Relative hrefs only — never include the origin (https://app.hypertask.ai).
                - **Comment Task Links**: ${COMMENT_TASK_LINK_RULE}
                - **Validation**: Never add an anchor tag if you lack a valid link. Do not prefix titles with "Task - ".

                ### 2.1. PERSPECTIVE & VOICE (drafting replies, comments, messages)
                - The person talking to you is the one in user_context. Every reply, comment, status update, or "next message" you draft is THEIR message: written in first person, from their perspective, addressing the other people on the ticket.
                - "The next logical reply" / "my reply" ALWAYS means the user_context person's own next message — NEVER the message the assignee or the thread's next likely author would write. If the last comment says someone else is picking the work up, the user's reply reacts to that (acknowledge, thank, ask); it does not speak as that person.
                - Never write a draft in the voice of anyone other than the user_context person unless they explicitly name someone else to impersonate.

                ### 3. COMPLETION REQUIREMENTS
                - **Integrity**: Always provide a COMPLETE response. Do not cut off mid-sentence or mid-thought.
                - **Prioritization**: If content is extensive, summarize key points to ensure you reach a proper conclusion.
                - **Closures**: Ensure all HTML tags are closed. Do NOT add trailing wrap-ups like "In summary" - end when the answer is complete.
                - **Restriction**: Do not begin your response with "Good Morning".

                ### 3.1. SUMMARY STYLE (when the user asks to summarize a ticket/task/discussion)
                - **Shorter than the source by default**: The summary must be shorter than the ticket's description + comments it is summarizing. Only exceed that if the ticket is genuinely complex (long history, many conflicting decisions) — and say so explicitly if you do.
                - **Cut the filler**: Skip restating the obvious, skip a "next steps" section unless next steps were actually asked for or are the point of the query.

                ### 4. TOOL SELECTION HIERARCHY
                ### 4.1. RAG vs MCP DECISION TREE
                    **Use RAGRetrievalTool when:**
                    - The query is conversational, ambiguous, or semantic
                      (e.g. "what's been happening with the auth bug", "summarize discussions on HTPR-3550")
                    - The query references specific task IDs or ticket numbers — RAG can locate
                      and return context around them without needing get_tasks
                    - Comments are part of the broader task context — RAG indexes both tasks and
                      comments together and will return relevant comment content automatically
                    - Never use RAG to list, enumerate, count, or check whether tasks exist on a board.
                      Its search index can lag behind the live board, so zero matches never means zero tasks.
                    **Use list_tasks when:**
                    - The user asks to list, enumerate, count, or check whether tasks exist on a board.
                      This is the live source of truth, including tasks created moments ago.
                    - The query contains explicit structured filters
                      (e.g. priority, assignee, section, status, labels, due dates)
                    - Examples: "list the tasks on this board", "all high priority tasks", "tasks due this week"
                    **Use search_tasks when:**
                    - The query contains a keyword, phrase, or partial task name to match against
                    - Examples: "find tasks mentioning payment gateway", "search for login issue tasks"
                    **Use get_tasks when:**
                    - You already have specific task IDs or ticket numbers from a previous tool call or when the user is requesting task specific information such as priority, estimates, tags, subtasks, etc.
                      AND you need full detail fields that RAG did not return
                      (e.g. attachments, followers, comment count, estimates)
                    - This is a detail enrichment step only — never use it as a search or discovery tool
                    - When a tool needs a task identifier, copy \`task_id\` exactly as returned by a previous search/list/get tool result; never infer task_id, ticket_number, or unique_index from a task's title.
                    **Use get_comments when:**
                    - The user is explicitly and specifically requesting comments on a task
                      (e.g. "show me all comments on HTPR-3550", "what's the latest comment on this task")
                    - Never use for conversational or contextual queries about task discussions — RAG covers this
                    **Use search_help_docs when:**
                    - The user asks how Hypertask itself works, or how to do something in the product
                      (e.g. "how do boards/columns work", "what does Ctrl+K do", "how do I change my AI model",
                      "how do notifications work", "what does it cost", "how do I connect an agent via MCP")
                    - This searches the Hypertask help center (help.hypertask.ai), NOT the user's own tasks.
                      Product/how-to questions → search_help_docs; questions about the user's own tasks,
                      comments, or board content → RAG/list_tasks/search_tasks. Cite the returned article URL.
                ### 4.2. WRITE OPERATIONS
                    RAG is read-only. For any write operation always use the appropriate tool directly:
                    - Create task → hypertask_create_task
                    - Update task (title, description, priority, due date, labels, status, move within board) → hypertask_update_task
                    - Adding or removing a tag/label → hypertask_update_task with add_labels / remove_labels.
                      NEVER use the "labels" field to add or remove a tag: "labels" REPLACES the task's
                      entire label set, so it silently deletes every tag you did not list. Swapping tag A
                      for tag B is remove_labels:["A"] + add_labels:["B"], never labels:["B"].
                      Only use "labels" when the user explicitly states the complete final list of tags.
                      Label names are accepted, you do not need to look up their ids first.
                      A tag change is reversible and never needs confirmation: apply it immediately and
                      report the result. Do not ask "shall I proceed?" before retagging, however many
                      tasks it covers.
                    - Move task to a different board → hypertask_move_task_between_boards
                    - Add comment → hypertask_add_comment
                    - Update/delete comment → hypertask_update_comment / hypertask_delete_comment
                    - ANYTHING about the user's OWN work → hypertask_my_tasks. "my tasks", "my workload",
                      "what am I working on", "how many tasks do I have", "what's overdue", "what do I have on
                      board X", and the first step before unassigning them from a board. It returns every task
                      assigned to them across every board with EXACT per-board counts. Never answer these from
                      hypertask_list_tasks, hypertask_search_tasks or a board-wide count: "how many tasks do I
                      have" means tasks ASSIGNED TO THEM, never the total number of tasks on their boards.
                    - Assign user → hypertask_assign_user
                    - Unassign user → hypertask_unassign_user
                    - Archive/unarchive inbox notifications → hypertask_inbox_archive / hypertask_inbox_unarchive
                    - Attach files from public URLs to a task description or comment → hypertask_attach_files
                    - List labels on a board → hypertask_list_labels
                    - Create label → hypertask_create_label
                    - List a board's custom fields (e.g. ICE, Story Points) → hypertask_list_custom_fields
                    - Set or clear a custom field's value on a task (e.g. "set ICE to 21 on THID-5") →
                      hypertask_set_custom_field_value. Pass create_field=true to explicitly create a missing
                      Number field. Pass value: null (or "") to clear an existing field.
                    - Create board from a structured manifest → hypertask_create_board
                    - List or read a standalone HTML report → hypertask_list_reports / hypertask_get_report
                    - Create, update, or delete a standalone HTML report → hypertask_create_report / hypertask_update_report / hypertask_delete_report
                    - Inspect or manage an agent's signed mention/assignment webhook → hypertask_agent_webhook. Use action=get for discovery; configure/test/replay/rotate/delete require cross-message confirmation.
                    - Query time entries across accessible work → hypertask_time_report
                    - Update the signed-in user's display name or profile photo → hypertask_update_profile
                    - Create a saved board view (a named, filtered lens on a board) → hypertask_create_view
                    - Rename or re-filter an existing view → hypertask_update_view (find its id first with hypertask_list_views)
                    - Configure sorting or subtask display when creating or updating a saved view → hypertask_create_view / hypertask_update_view
                    - Switch the user to a different view / back to the default view → hypertask_switch_view
                    - Delete a saved board view → hypertask_delete_view (find its id first with hypertask_list_views)
                    - Create/rename/delete section → hypertask_section
                    - Create/list/update/publish/delete draft → hypertask_draft
                    - After a successful create/update/comment/assign/unassign/move/archive/unarchive/attach/label/board/section/draft action, confirm it to the user and link the
                      ticket with the exact url returned by the tool: <a href="{{task.url}}">{{task.title}}</a>
                    - **Wide or destructive writes are confirmed BEFORE they run.** If any write tool
                      returns confirmation_required, nothing was changed. Stop there: end your turn, list the
                      affected tasks for the user, and ask them to confirm. Only when they say yes in a NEW
                      message do you call the tool again with confirmed: true. Never set confirmed: true to
                      approve your own proposal in the same turn, it will be rejected.

                ### 4.3. BOARD AGENTS
                - When context_list contains an agent mention (type "agent") or the user addresses @AgentName, call hypertask_ask_agent with that agent's id and a focused question.
                - After the tool returns success: true, synthesize one reply combining the agent's domain answer with relevant board context. Attribute the answer by name (for example, "According to inne Wiki, ...") and keep any citations or sources the agent included.
                - **If the tool returns success: false, do not answer the question from your own general knowledge in the same reply.** Tell the user plainly, by name, that the agent could not be reached right now, in a short user-safe sentence (do not quote the tool's raw error text), and stop. Never present your own knowledge as if it came from the agent, and never blend a disclaimer with a substantive answer in one breath.

                ### 5. METADATA FILTERING LOGIC
                - **Default**: Apply default_context.project_id to metadata filters, so questions default to the board the user is looking at.
                - **default_context.surface says which screen the user is on.** Answer "where am I?" with it.
                  surface "my_tasks" is the My Tasks page: their own work across EVERY board, no project_id.
                  There, hypertask_my_tasks is your DEFAULT first tool call for any question about their work,
                  and never say you lack board context. "inbox" and "calendar" also span all boards, so they
                  carry no project_id either. "board" and "task_detail" do carry one.
                - **default_context.view_name / view_id say which View (saved filtered tab) of the board is currently active on screen.** Views are board-scoped saved filters, a lot like sub-boards. If the user asks "which view am I on?", answer with view_name. When view_id is absent the user is on the board's default (all tasks) view named by view_name.
                - **default_context.task_id says which ticket is on screen, it does not scope the request.**
                  If the user names a SET ("all tasks tagged X", "every task in Done"), act on the WHOLE set even
                  while a ticket is open: find it with hypertask_list_tasks, then change every match in ONE
                  hypertask_update_task call via task_ids.
                - **Due dates: enumerate with hypertask_list_tasks(has_due_date: true), never hypertask_search_tasks.**
                  Semantic search is relevance-ranked and truncated, so it will miss due-dated tasks. For any
                  "which tasks have due dates" / "clear the due dates" request, list them exhaustively with the
                  has_due_date filter and paginate. A date sitting in a task's title or description is NOT a due
                  date - only the dueDate field is; do not infer due dates from text.
                - **Never let a partial result read as a complete one.** A phrase like "remove tag X and replace it
                  with tag Y" is ambiguous when a ticket is open: it may mean this task, or every task carrying X.
                  Apply it to the open task, but BEFORE you answer, check with hypertask_list_tasks whether other
                  tasks still carry X. If any do, say so plainly and offer to do them too, e.g.
                  "Updated HTPR-1. 2 other tasks still have the X tag (HTPR-2, HTPR-3) - want me to change those as well?"
                  Do not silently leave them behind.
                - **State the count on any multi-task write** ("retagged 3 tasks: ..."). If you changed fewer than asked, say why.
                - **Filter inference**: From the user query add filters when relevant (e.g. "tasks assigned to me" -> assignees, "tasks in Done section" -> section_title, "high priority" -> priority).
                - **Only pass the filters the user actually asked for. Leave every other optional argument UNSET.**
                  Do not default-fill created_by, assigned_to, has_comments, has_attachments, priority, labels, etc.
                  A stray created_by or has_comments silently narrows the result and makes a full board look empty.
                - **Valid filter keys**: projectid, taskId, assignees, createdBy, hasSubtasks, isSubtask, mentions, priority, sectionId, section_title, size, subtaskIds, subtaskUniqueIndexes, tagIds, ticketNumber, uniqueIndex, relatedToAndFromTasks, title (exact match only; prefer semantic query for title-like searches).
                - **Filter key preference**: Use taskId>ticketNumber>uniqueIndex for task filters.

                ### FINAL REMINDER
                Section 0 OUTPUT STYLE binds every response: bottom line up front, scannable bullets, bold content, ~120 words unless depth was explicitly requested.
            `;

export const writeToolNames = new Set([
  "hypertask_ask_agent",
  "hypertask_create_task",
  "hypertask_update_task",
  "hypertask_task_description_history",
  "hypertask_page_history",
  "hypertask_create_page",
  "hypertask_update_page",
  "hypertask_add_comment",
  "hypertask_update_comment",
  "hypertask_delete_comment",
  "hypertask_assign_user",
  "hypertask_unassign_user",
  "hypertask_move_task_between_boards",
  "hypertask_inbox_archive",
  "hypertask_inbox_unarchive",
  "hypertask_move_task_to_inbox",
  "hypertask_attach_files",
  "hypertask_create_label",
  "hypertask_create_board",
  "hypertask_create_agent",
  "hypertask_agent_webhook",
  "hypertask_revoke_agent",
  "hypertask_mint_token",
  "hypertask_revoke_token",
  "hypertask_board_config",
  "hypertask_project_admin",
  "hypertask_section",
  "hypertask_draft",
  "hypertask_create_view",
  "hypertask_update_view",
  "hypertask_switch_view",
  "hypertask_delete_view",
  "hypertask_start_timer",
  "hypertask_stop_timer",
  "hypertask_pause_timer",
  "hypertask_resume_timer",
  "hypertask_log_time",
  "hypertask_link_tasks",
  "hypertask_decision_request",
  "hypertask_create_skill",
  "hypertask_update_skill",
  "hypertask_delete_skill",
  "hypertask_import_skills",
  "hypertask_create_report",
  "hypertask_update_report",
  "hypertask_delete_report",
  "hypertask_update_profile",
  "hypertask_set_custom_field_value",
]);

export function sseFrame(event: SseEvent, data: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createSseErrorResponse(message: string, status?: number) {
  return new Response(
    sseFrame("error", { content: message }) +
      sseFrame("done", { status: "error" }),
    { ...(status ? { status } : {}), headers: SSE_HEADERS }
  );
}

export function handledErrorExtra(error: unknown) {
  if (!error || typeof error !== "object") return {};
  const record = error as Record<string, unknown>;
  const extra: Record<string, string | number | boolean | null> = {};
  for (const key of ["statusCode", "status"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      extra[key] = value;
    }
  }
  return extra;
}

export function includedAllowanceError(error: unknown) {
  let current: unknown = error;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 8 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (current instanceof Error) {
      if (current.name === "SharedAiAllowanceExceededError") {
        return current as Error & { periodKey?: string };
      }
      const wrapped = current as Error & {
        cause?: unknown;
        lastError?: unknown;
      };
      current = wrapped.cause ?? wrapped.lastError;
      continue;
    }
    if (typeof current === "object") {
      const wrapped = current as { cause?: unknown; lastError?: unknown };
      current = wrapped.cause ?? wrapped.lastError;
      continue;
    }
    break;
  }
  return null;
}

export function userFacingErrorMessage(error: unknown, stage: string) {
  console.error(`[ai/chat/stream] ${stage} user-facing error`, error);
  const allowanceError = includedAllowanceError(error);
  if (allowanceError) return allowanceError.message;
  return "Sorry, something went wrong while generating a response. Please try again.";
}

export function userFacingErrorDetails(error: unknown, teamId: string | null) {
  const periodKey = includedAllowanceError(error)?.periodKey;
  if (!periodKey) return {};
  return {
    allowancePeriod: periodKey,
    ...(teamId ? { allowanceTeamId: teamId } : {}),
  };
}

export function requestErrorMessage(
  error: unknown,
  stage: "body" | "validation",
) {
  console.error(`[ai/chat/stream] request-${stage} user-facing error`, error);
  if (stage === "body") {
    return "Invalid request: the request body could not be read.";
  }
  if (!(error instanceof z.ZodError) || error.issues.length === 0) {
    return "Invalid request.";
  }

  const fieldIssues = error.issues.flatMap((issue) => {
    const field = issue.path
      .filter((part): part is string => typeof part === "string")
      .map((part) =>
        part
          .replace(/_/g, " ")
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .toLowerCase(),
      )
      .join(" ");
    return field ? [{ field, code: issue.code }] : [];
  });
  const fields = [...new Set(fieldIssues.map(({ field }) => field))];
  if (fields.length === 0) return "Invalid request.";
  const fieldList =
    fields.length === 1
      ? fields[0]
      : `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`;
  // A missing value reads as "required"; anything else is "invalid".
  const fieldsAreRequired = fieldIssues.every(
    ({ code }) => code === "too_small" || code === "invalid_type",
  );
  return `Invalid request: ${fieldList} ${fields.length === 1 ? "is" : "are"} ${
    fieldsAreRequired ? "required" : "invalid"
  }.`;
}

export async function reportHandledChatError(
  error: unknown,
  stage: string,
  extra?: Record<string, string | number | boolean | null>,
) {
  if (includedAllowanceError(error)) return;
  if (
    error instanceof Error &&
    (error.name === "AiPlanAccessError" ||
      error.name === "AiGatewayKeyRequiredError")
  ) {
    return;
  }
  const normalized =
    error instanceof Error ? error : new Error(errorMessage(error));
  await reportError({
    message: normalized.message,
    stack: normalized.stack,
    url: "/api/ai/chat/stream",
    source: "handled",
    extra: { stage, ...handledErrorExtra(error), ...extra },
  });
}

export const EMPTY_COMPLETION_TICKET_THRESHOLD = 50;

export async function reportEmptyCompletion(retryFailed: boolean, error: unknown) {
  if (retryFailed) {
    await reportHandledChatError(error, "empty-completion-retry");
    return;
  }

  const normalized = new Error("AI chat returned an empty completion");
  await reportError({
    message: normalized.message,
    stack: normalized.stack,
    url: "/api/ai/chat/stream",
    source: "handled",
    extra: { stage: "empty-completion" },
    minimumOccurrences: EMPTY_COMPLETION_TICKET_THRESHOLD,
    fingerprintKey: "ai-chat-empty-completion",
  });
}

export function claudeAcceptsTemperature(model: string | null | undefined) {
  const normalized = String(model || "").toLowerCase();
  return !CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

export function selectionFromModelOption(option: TAiModelOption): {
  provider: ProviderId;
  model: string;
  modelOption: TAiModelOption;
} {
  return {
    provider: option.source,
    model: option.model,
    modelOption: option,
  };
}

export type ModelSelection = {
  provider: ProviderId;
  model: string;
  modelOption?: TAiModelOption;
};

export function defaultModelSelection(
  settings?: unknown,
  feature: UserFacingModelFeature = "aiChat",
  personalModelOptionId?: string | null,
  customEndpointConfigured = true,
  defaultModelOption = defaultAiModelOption,
) {
  const option = resolveUserFacingModelOption(
    feature,
    settings,
    personalModelOptionId,
    { customEndpointConfigured, defaultModelOption },
  );
  if (!option) throw new Error("This AI feature is turned off for your team");
  return selectionFromModelOption(filterModelOptionForTeam(option, settings));
}

export function normalizeProviderId(provider: string | null | undefined): ProviderId {
  const source = String(provider ?? "").trim().toLowerCase();
  if (
    source === "claude" ||
    source === "openai" ||
    source === "openrouter" ||
    source === "gateway" ||
    source === "custom"
  ) {
    return source;
  }
  return DEFAULT_PROVIDER;
}

export function resolveModelSelection(
  providerInput: string | null | undefined,
  modelInput: string | null | undefined,
  modelOptionId: string | null | undefined,
  settings: unknown,
  feature: UserFacingModelFeature,
  personalModelOptionId: string | null,
  defaultModelOption: TAiModelOption,
): ModelSelection {
  const provider = normalizeProviderId(providerInput);
  const requestedModel = modelInput?.trim();

  if (provider === "openrouter" && requestedModel) {
    return { provider, model: requestedModel };
  }

  const modelOption =
    getAiModelOptionById(modelOptionId) ?? getAiModelOptionById(requestedModel);
  if (modelOption) return selectionFromModelOption(modelOption);

  return defaultModelSelection(
    settings,
    feature,
    personalModelOptionId,
    true,
    defaultModelOption,
  );
}

export function selectModel(
  provider: ProviderId,
  modelId: string | null | undefined,
  byokCredential: AiModelCredential | undefined,
  modelOption?: TAiModelOption,
  tags?: AiGatewayTags
): {
  model: LanguageModel;
  settings: { temperature?: number; maxOutputTokens?: number };
  providerOptions?: AiProviderOptions;
  usageProvider: string;
  resolvedModelId: string;
} {
  const requestedModel = modelId?.trim();
  const usageProvider = aiUsageProviderForCredential(
    provider,
    byokCredential,
    modelOption
  );

  switch (provider) {
    case "claude": {
      const model =
        requestedModel && CLAUDE_MODELS.has(requestedModel)
          ? requestedModel
          : DEFAULT_CLAUDE_MODEL;
      const aiModel = resolveAiModel(provider, model, byokCredential);
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: claudeAcceptsTemperature(model) ? { temperature: 0.2 } : {},
        providerOptions: providerOptionsForAiModel(
          aiModel,
          "chat",
          tags,
          modelOption
        ),
      };
    }
    case "openai": {
      const model =
        requestedModel && OPENAI_MODELS.has(requestedModel)
          ? requestedModel
          : DEFAULT_MODEL;
      const aiModel = resolveAiModel(provider, model, byokCredential);
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: {
          temperature: model.toLowerCase().startsWith("gpt-5") ? 1 : 0.2,
        },
        providerOptions: providerOptionsForAiModel(
          aiModel,
          "chat",
          tags,
          modelOption
        ),
      };
    }
    case "openrouter": {
      const model = requestedModel || DEFAULT_MODEL;
      const aiModel = resolveAiModel(provider, model, byokCredential);
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
        providerOptions: providerOptionsForAiModel(aiModel, "chat", tags),
      };
    }
    case "gateway": {
      const model = requestedModel || defaultAiModelOption.model;
      const aiModel = resolveAiModel(
        provider,
        model,
        byokCredential,
        modelOption
      );
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
        providerOptions: providerOptionsForAiModel(
          aiModel,
          "chat",
          tags,
          modelOption
        ),
      };
    }
    case "custom": {
      if (!isCustomEndpointConfig(byokCredential)) {
        throw new Error("A complete custom endpoint is required");
      }
      return {
        model: resolveAiModel(provider, "custom", byokCredential),
        resolvedModelId: byokCredential.modelId,
        usageProvider,
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
      };
    }
  }
}

export function formatTemporalContext(timezone = "UTC") {
  const now = new Date();
  const formattedDisplay = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(now);
  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(now)
  );
  const month = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "numeric",
    }).format(now)
  );
  const timePeriod =
    hour >= 5 && hour < 12
      ? "morning"
      : hour >= 12 && hour < 17
        ? "afternoon"
        : hour >= 17 && hour < 21
          ? "evening"
          : "night";
  const season =
    month === 12 || month <= 2
      ? "winter"
      : month <= 5
        ? "spring"
        : month <= 8
          ? "summer"
          : "fall";
  const weekend = dayOfWeek === "Saturday" || dayOfWeek === "Sunday";

  return (
    "<system-reminder>\n" +
    `Today's Date & Time: ${formattedDisplay}\n` +
    `Day of Week: ${dayOfWeek}\n` +
    `Time Period: ${timePeriod}\n` +
    `Season: ${season}\n` +
    `Timezone: ${timezone}\n` +
    `Weekend: ${weekend ? "Yes" : "No"}\n` +
    "</system-reminder>"
  );
}

export function formatChatHistory(chatHistory: ChatRequest["chat_history"]) {
  if (!chatHistory?.length) return "No previous conversation.";
  const messages = chatHistory
    .slice(-15)
    .map((message, index) => ({
      index,
      role: message.role?.toLowerCase() === "assistant" ? "assistant" : "human",
      content: message.content || "",
    }))
    .filter((message) => message.content.trim().length > 0);

  if (messages.length === 0) return "No readable conversation history.";

  const immediate = messages.slice(-3);
  const recent = messages.slice(Math.max(0, messages.length - 10), -3);
  const earlier = messages.slice(0, Math.max(0, messages.length - 10));
  const parts: string[] = [];

  parts.push("=== CURRENT TIME CONTEXT ===");
  parts.push(`[Current Time: ${new Date().toISOString()}]`);
  parts.push("");

  if (immediate.length) {
    parts.push("=== IMMEDIATE CONVERSATIONAL CONTEXT ===");
    parts.push("(This is the most important context for your response)");
    immediate.forEach((message, index) => {
      const roleLabel =
        message.role === "assistant"
          ? "YOU JUST RESPONDED"
          : index === immediate.length - 1
            ? "USER IS NOW ASKING"
            : "USER ASKED";
      parts.push(`${roleLabel}: ${message.content}`);
    });
    parts.push("");
  }

  if (recent.length) {
    parts.push("=== RECENT CONVERSATION HISTORY ===");
    recent.forEach((message) => {
      const roleLabel = message.role === "assistant" ? "YOU SAID" : "USER SAID";
      parts.push(`${roleLabel}: ${message.content}`);
    });
    parts.push("");
  }

  if (earlier.length) {
    parts.push("=== EARLIER CONVERSATION ===");
    earlier.slice(-6).forEach((message) => {
      const roleLabel = message.role === "assistant" ? "YOU" : "USER";
      parts.push(`[${roleLabel}]: ${message.content}`);
    });
  }

  return parts.join("\n");
}

export function withHigherEffort(
  providerOptions: Record<string, Record<string, any>> | undefined
): Record<string, Record<string, any>> | undefined {
  if (!providerOptions) return providerOptions;
  const next: Record<string, Record<string, any>> = { ...providerOptions };
  if (next.openai) {
    next.openai = { ...next.openai, reasoningEffort: "high" };
  }
  if (next.anthropic) {
    next.anthropic = {
      ...next.anthropic,
      effort: "high",
      thinking: { type: "adaptive" },
    };
  }
  return next;
}

export function stringifyForPrompt(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

export function createDocumentContext(body: ChatRequest) {
  const files = [
    ...(body.images64 ?? []),
    ...(body.pdfs64 ?? []),
    ...(body.docx64 ?? []),
  ];
  if (files.length === 0) return "";
  return files
    .map((file) => {
      const type = file.mimeType || "unknown";
      const name = file.fileName || "unnamed attachment";
      return `- ${name} (${type})`;
    })
    .join("\n");
}

export function createUserPrompt(
  body: ChatRequest,
  authedUser: AuthedUser,
  currentTaskContext: string
) {
  return `
                ${formatTemporalContext()}
                ${
                  currentTaskContext
                    ? `\n                CURRENT TICKET CONTEXT (the ticket the user is viewing — read this before answering questions about "this ticket"; do NOT search for it):\n${currentTaskContext}\n`
                    : ""
                }
                User query: ${body.message}
                CHAT HISTORY: ${formatChatHistory(body.chat_history)}
                context_list: ${stringifyForPrompt(body.context_list)}
                default_context: ${stringifyForPrompt(body.default_context)}
                user_context: ${stringifyForPrompt({
                  id: authedUser.id,
                  email: authedUser.email,
                  displayName: authedUser.displayName,
                })}
                document_context: ${createDocumentContext(body)}
                ${
                  isLiveTaskListRequest(body.message)
                    ? "MANDATORY: This request needs the live board state. Call hypertask_list_tasks and do not use rag_retrieval."
                    : ""
                }

                IMPORTANT: Analyze the history and provide a complete, context-aware HTML body response.
                IMPORTANT: Follow the tool selection hierarchy strictly.
                IMPORTANT: User context is provided already. If you want to know more about the user's boards, then use the list_boards tool.
                IMPORTANT: Take into account the documents and images provided by the user.
            `;
}

export function parseDataUrl(url: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(url);
  if (!match) return null;
  return {
    mediaType: match[1] || "application/octet-stream",
    isBase64: Boolean(match[2]),
    data: match[3] || "",
  };
}

export function filePartFromAttachment(
  attachment: z.infer<typeof attachmentSchema>
): FilePart | null {
  if (!attachment.url) return null;
  const mediaType = attachment.mimeType || "application/octet-stream";
  const dataUrl = parseDataUrl(attachment.url);
  if (dataUrl?.isBase64) {
    return {
      type: "file",
      mediaType: attachment.mimeType || dataUrl.mediaType,
      filename: attachment.fileName,
      data: { type: "data", data: dataUrl.data },
    };
  }

  try {
    return {
      type: "file",
      mediaType,
      filename: attachment.fileName,
      data: new URL(attachment.url),
    };
  } catch {
    return null;
  }
}

export function createUserContent(
  body: ChatRequest,
  authedUser: AuthedUser,
  currentTaskContext: string
): UserContent {
  const prompt = createUserPrompt(body, authedUser, currentTaskContext);
  const fileParts = [
    ...(body.images64 ?? []),
    ...(body.pdfs64 ?? []),
    ...(body.docx64 ?? []),
  ]
    .map(filePartFromAttachment)
    .filter((part): part is FilePart => part !== null);

  if (fileParts.length === 0) return prompt;
  return [{ type: "text", text: prompt }, ...fileParts];
}

export async function loadActingAgent(
  sessionId: string | undefined,
  userId: number
): Promise<{
  id: string;
  displayName: string;
  prompt: string | null;
  modelOptionId: string | null;
} | null> {
  if (!sessionId) return null;

  const session = await chatStore().sessions.findFirst({
    where: { id: sessionId, userId },
    select: { agentId: true },
  });
  if (!session?.agentId) return null;

  return prisma.agent.findFirst({
    where: {
      id: session.agentId,
      userId,
      runtimeType: "NATIVE",
      revokedAt: null,
    },
    select: {
      id: true,
      displayName: true,
      prompt: true,
      modelOptionId: true,
    },
  });
}

export function fallbackTitle(message: string) {
  return message
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 8)
    .join(" ")
    .replace(/^["']|["']$/g, "")
    .replace(/[.!?;:,]+$/g, "")
    .trim();
}

export async function generateConversationTitle(
  content: string,
  message: string,
  byokApiKey?: string,
  tags?: AiGatewayTags,
  usageContext?: {
    userId: number;
    projectId?: number | null;
    taskId?: number | null;
    agentId?: string | null;
  },
  abortSignal?: AbortSignal,
) {
  const fallback = fallbackTitle(message);
  if (!byokApiKey && !isAiGatewayEnabled()) {
    return fallback;
  }
  try {
    const model = resolveAiModel("openai", "gpt-5.4-mini", byokApiKey);
    const result = await generateText({
      model,
      instructions:
        "Write a very short chat thread title (at most 8 words). No quotes. No trailing punctuation. Output only the title text.",
      messages: [{ role: "user", content: content || message }],
      temperature: 1,
      maxRetries: 1,
      abortSignal,
      providerOptions: providerOptionsForAiModel(model, "chat", tags),
    });
    if (usageContext) {
      await logAiUsage({
        ...usageContext,
        teamId: tags?.teamId ?? null,
        provider: "openai",
        model: "gpt-5.4-mini",
        feature: "chat",
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        totalTokens: result.usage.totalTokens ?? 0,
      });
    }
    const cleaned = fallbackTitle(result.text);
    return cleaned || fallback;
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    console.error("[ai/chat/stream] title generation failed", error);
    return fallback;
  }
}
