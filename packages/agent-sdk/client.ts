import type {
  AgentActivity,
  AgentActivityOption,
  AgentAttachment,
  AgentClientOptions,
  AgentEventHandler,
  AgentEventName,
  AgentEventSubscription,
  AgentRun,
  AgentRunRecord,
  AgentTask,
  AgentTaskHelpers,
  AgentTaskUpdate,
  AgentThreadItem,
  AgentWebhookPayload,
} from "./types.js";

const DEFAULT_API_URL = "https://api.hypertask.ai/api";
const TASK_LEASE_TTL_SECONDS = 300;
const TASK_LEASE_HEARTBEAT_MS = 60_000;
const AUTO_THOUGHT_MS = 8_000;
const RUN_STATUS_POLL_MS = 5_000;
const THREAD_ITEM_LIMIT = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTACHMENT_CONTENT_TYPES: Record<string, string> = {
  apk: "application/vnd.android.package-archive",
  csv: "text/csv",
  gif: "image/gif",
  gz: "application/gzip",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  tar: "application/x-tar",
  txt: "text/plain",
  webp: "image/webp",
  zip: "application/zip",
};

type JsonObject = Record<string, unknown>;
type RequestOptions = {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

type HydratedContext = {
  record: AgentRunRecord;
  ticket: AgentTask | null;
  thread: AgentThreadItem[];
};

export class AgentSdkError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly response?: unknown,
  ) {
    super(message);
    this.name = "AgentSdkError";
  }
}

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentSdkError(`${label} returned an invalid response`);
  }
  return value as JsonObject;
}

function arrayValue<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) {
    throw new AgentSdkError(`${label} returned an invalid response`);
  }
  return value as T[];
}

function responseMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const body = value as JsonObject;
  if (typeof body.message === "string" && body.message) return body.message;
  if (typeof body.error === "string" && body.error) return body.error;
  return fallback;
}

function eventForPayload(payload: AgentWebhookPayload): AgentEventName {
  if (payload.event === "run.prompted") return "prompted";
  if (payload.event === "run.stopped") return "stop";
  if (payload.event !== "run.created") {
    throw new AgentSdkError(`Unsupported run event: ${payload.event}`);
  }
  const trigger = payload.run?.trigger;
  if (trigger === "mention" || trigger === "assigned" || trigger === "chat") {
    return trigger;
  }
  throw new AgentSdkError("run.created has an unknown trigger");
}

function chronological(a: AgentThreadItem, b: AgentThreadItem): number {
  const difference = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (Number.isFinite(difference) && difference !== 0) return difference;
  if (typeof a.id === "number" && typeof b.id === "number") return a.id - b.id;
  return String(a.id).localeCompare(String(b.id));
}

export class AgentClient {
  private readonly baseUrl: string;
  private readonly requestFetch: typeof globalThis.fetch;
  private readonly handlers = new Map<AgentEventSubscription, Set<AgentEventHandler>>();
  private readonly activeRuns = new Map<
    string,
    { controller: AbortController; references: number }
  >();
  private readonly onErrorCallback?: AgentClientOptions["onError"];

  private readonly token: string;

  constructor(token: string, options: Omit<AgentClientOptions, "token"> = {}) {
    this.token = token.trim();
    if (!this.token) throw new AgentSdkError("token is required");
    this.baseUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.requestFetch = options.fetch ?? globalThis.fetch;
    if (typeof this.requestFetch !== "function") {
      throw new AgentSdkError("A Fetch API implementation is required");
    }
    this.onErrorCallback = options.onError;
  }

  on(event: AgentEventSubscription, handler: AgentEventHandler): () => void {
    const handlers = this.handlers.get(event) ?? new Set<AgentEventHandler>();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    });
    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
    if (options.idempotencyKey) {
      headers.set("Idempotency-Key", options.idempotencyKey);
    }

    let response: Response;
    try {
      response = await this.requestFetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body,
        signal: options.signal,
      });
    } catch (error) {
      throw new AgentSdkError(
        error instanceof Error ? error.message : "Hypertask request failed",
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new AgentSdkError(
        error instanceof Error ? error.message : "Failed to read Hypertask response",
        response.status,
      );
    }
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new AgentSdkError(
          `Hypertask returned non-JSON HTTP ${response.status}`,
          response.status,
          text.slice(0, 300),
        );
      }
    }
    const logicalFailure =
      parsed !== null &&
      typeof parsed === "object" &&
      "success" in parsed &&
      (parsed as { success?: unknown }).success === false;
    if (!response.ok || logicalFailure) {
      throw new AgentSdkError(
        responseMessage(parsed, `Hypertask returned HTTP ${response.status}`),
        response.status,
        parsed,
      );
    }
    return parsed as T;
  }

  reportError(error: unknown, payload?: AgentWebhookPayload): void {
    if (!this.onErrorCallback) {
      console.error("[hypertask-agent-sdk]", error);
      return;
    }
    try {
      void Promise.resolve(this.onErrorCallback(error, payload)).catch((callbackError) =>
        console.error("[hypertask-agent-sdk] onError callback failed", callbackError),
      );
    } catch (callbackError) {
      console.error("[hypertask-agent-sdk] onError callback failed", callbackError);
    }
  }

  async assertPayloadAccess(
    payload: AgentWebhookPayload,
    signal?: AbortSignal,
  ): Promise<AgentRunRecord> {
    const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
    if (!runId) throw new AgentSdkError("Run webhook is missing runId");
    const response = objectValue(
      await this.request(`/mcp/agents/runs/${encodeURIComponent(runId)}`, { signal }),
      "Agent run",
    );
    const run = objectValue(response.run, "Agent run") as AgentRunRecord;
    if (
      run.id !== runId ||
      run.agentId !== payload.agentId ||
      run.taskId !== payload.taskId ||
      (payload.run &&
        (payload.run.id !== run.id ||
          payload.run.agentId !== run.agentId ||
          payload.run.taskId !== run.taskId ||
          payload.run.chatSessionId !== run.chatSessionId))
    ) {
      throw new AgentSdkError("Webhook run does not belong to this agent token");
    }
    return run;
  }

  async dispatch(
    payload: AgentWebhookPayload,
    preflightRun: AgentRunRecord,
    claimSignal?: AbortSignal,
  ): Promise<void> {
    const event = eventForPayload(payload);
    let runRecord = preflightRun;
    if (
      event !== "stop" &&
      runRecord.taskId === null &&
      runRecord.chatSessionId === null
    ) {
      throw new AgentSdkError("Agent run has no task or chat context");
    }
    if (event !== "stop") {
      runRecord = await this.assertPayloadAccess(payload, claimSignal);
      if (runRecord.status === "stopped" || runRecord.status === "done") {
        throw new AgentSdkError("Run is no longer active");
      }
    }
    if (event === "stop") this.activeRuns.get(runRecord.id)?.controller.abort();
    const execution = this.acquireRun(runRecord.id, event === "stop");
    const dispatchController = new AbortController();
    let claimError: unknown;
    const abortForRunStop = () =>
      dispatchController.abort(execution.controller.signal.reason);
    const abortForLostClaim = () => {
      claimError =
        claimSignal?.reason ?? new AgentSdkError("Webhook delivery claim was lost");
      dispatchController.abort(claimError);
    };
    execution.controller.signal.addEventListener("abort", abortForRunStop, { once: true });
    claimSignal?.addEventListener("abort", abortForLostClaim, { once: true });
    if (execution.controller.signal.aborted) abortForRunStop();
    if (claimSignal?.aborted) abortForLostClaim();

    let statusCheckError: unknown;
    let statusCheckPromise: Promise<void> | null = null;
    const statusMonitor =
      event === "stop"
        ? null
        : setInterval(() => {
            if (statusCheckPromise || dispatchController.signal.aborted) return;
            statusCheckPromise = this.assertPayloadAccess(
              payload,
              dispatchController.signal,
            )
              .then((currentRun) => {
                if (currentRun.status === "stopped" || currentRun.status === "done") {
                  throw new AgentSdkError("Run is no longer active");
                }
              })
              .catch((error) => {
                if (dispatchController.signal.aborted) return;
                statusCheckError = error;
                dispatchController.abort(error);
              })
              .finally(() => {
                statusCheckPromise = null;
              });
          }, RUN_STATUS_POLL_MS);
    (statusMonitor as unknown as { unref?: () => void } | null)?.unref?.();

    try {
      const contextlessStop =
        event === "stop" &&
        runRecord.taskId === null &&
        runRecord.chatSessionId === null;
      const hydrationSignal = event === "stop" ? claimSignal : dispatchController.signal;
      const context = contextlessStop
        ? { record: runRecord, ticket: null, thread: [] }
        : await this.hydrateContext(runRecord, hydrationSignal);
      const run = new AgentRunImpl(
        this,
        context,
        event,
        typeof payload.prompt === "string" ? payload.prompt : null,
        payload.signal === "select" && payload.selection ? payload.selection : null,
        payload.deliveryId,
        dispatchController.signal,
      );
      const handlers = [
        ...(this.handlers.get(event) ?? []),
        ...(this.handlers.get("*") ?? []),
      ];

      let autoThoughtError: unknown;
      let autoThoughtFailed = false;
      let autoThoughtDone = Promise.resolve();
      let cancelAutoThought = () => {};
      if (event !== "stop") {
        autoThoughtDone = new Promise<void>((resolve, reject) => {
          let started = false;
          const timer = setTimeout(() => {
            started = true;
            run.automaticThought().then(() => resolve(), reject);
          }, AUTO_THOUGHT_MS);
          (timer as unknown as { unref?: () => void }).unref?.();
          cancelAutoThought = () => {
            if (started) return;
            clearTimeout(timer);
            resolve();
          };
          run.onFirstActivity(cancelAutoThought);
        }).catch((error) => {
          autoThoughtFailed = true;
          autoThoughtError = error;
        });
      }

      try {
        for (const handler of handlers) await handler(run);
        cancelAutoThought();
        await autoThoughtDone;
        if (autoThoughtFailed) throw autoThoughtError;
      } catch (error) {
        cancelAutoThought();
        await autoThoughtDone;
        throw error;
      }
      if (claimError) throw claimError;
      if (statusCheckError) throw statusCheckError;
    } finally {
      if (statusMonitor) clearInterval(statusMonitor);
      dispatchController.abort();
      await statusCheckPromise;
      execution.controller.signal.removeEventListener("abort", abortForRunStop);
      claimSignal?.removeEventListener("abort", abortForLostClaim);
      execution.release();
    }
  }

  private acquireRun(runId: string, stopped: boolean) {
    let active = this.activeRuns.get(runId);
    if (!active) {
      active = { controller: new AbortController(), references: 0 };
      this.activeRuns.set(runId, active);
    }
    if (stopped) active.controller.abort();
    active.references += 1;
    return {
      controller: active.controller,
      release: () => {
        const current = this.activeRuns.get(runId);
        if (!current || current.controller !== active!.controller) return;
        current.references -= 1;
        if (current.references === 0) this.activeRuns.delete(runId);
      },
    };
  }

  private async hydrateContext(
    record: AgentRunRecord,
    signal?: AbortSignal,
  ): Promise<HydratedContext> {
    const { taskId, chatSessionId } = record;
    if (taskId === null && chatSessionId === null) {
      throw new AgentSdkError("Agent run has no task or chat context");
    }
    const activitiesPromise = this.request<{ activities: AgentActivity[] }>(
      `/mcp/agents/runs/${encodeURIComponent(record.id)}/activities`,
      { signal },
    ).then((response) =>
      arrayValue<AgentActivity>(
        objectValue(response, "Agent activities").activities,
        "Agent activities",
      ).map((activity) => ({
        kind: "activity" as const,
        ...activity,
      })),
    );

    if (taskId !== null) {
      const [taskResponse, commentResponse, activities] = await Promise.all([
        this.request<{ task?: AgentTask; tasks?: AgentTask[] }>(
          `/mcp/tasks?task_id=${taskId}`,
          { signal },
        ),
        this.request<{
          comments: Array<{
            id: number;
            text: string;
            commentText?: string;
            createdAt: string;
            creator?: unknown;
            agent?: unknown;
          }>;
        }>(
          `/mcp/comments?task_id=${taskId}&limit=${THREAD_ITEM_LIMIT}&sort_order=desc`,
          { signal },
        ),
        activitiesPromise,
      ]);
      const taskBody = objectValue(taskResponse, "Run task");
      const ticket =
        (taskBody.task as AgentTask | undefined) ??
        arrayValue<AgentTask>(taskBody.tasks ?? [], "Run task list")[0] ??
        null;
      if (!ticket || ticket.id !== taskId) {
        throw new AgentSdkError("Run task is unavailable to this agent token");
      }
      const comments: AgentThreadItem[] = arrayValue<
        {
          id: number;
          text: string;
          commentText?: string;
          createdAt: string;
          creator?: unknown;
          agent?: unknown;
        }
      >(
        objectValue(commentResponse, "Task comments").comments,
        "Task comments",
      ).map((comment) => ({
        kind: "comment",
        id: comment.id,
        text: comment.commentText ?? comment.text,
        createdAt: comment.createdAt,
        creator: comment.creator,
        agent: comment.agent,
      }));
      return {
        record,
        ticket,
        thread: [...comments, ...activities].sort(chronological),
      };
    }

    const [chatResponse, activities] = await Promise.all([
      this.request<{
        messages: Array<{
          id: string;
          role: "human" | "assistant";
          content: string;
          createdAt: string;
        }>;
      }>(`/mcp/chat/sessions/${encodeURIComponent(chatSessionId!)}/messages`, {
        signal,
      }),
      activitiesPromise,
    ]);
    const messages: AgentThreadItem[] = arrayValue<
      {
        id: string;
        role: "human" | "assistant";
        content: string;
        createdAt: string;
      }
    >(
      objectValue(chatResponse, "Chat messages").messages,
      "Chat messages",
    ).map((message) => ({
      kind: "message",
      id: message.id,
      text: message.content,
      role: message.role,
      createdAt: message.createdAt,
    }));
    return {
      record,
      ticket: null,
      thread: [...messages, ...activities].sort(chronological),
    };
  }
}

class AgentRunImpl implements AgentRun {
  private static readonly taskLeaseTails = new Map<number, Promise<void>>();

  readonly id: string;
  readonly agentId: string;
  readonly taskId: number | null;
  readonly chatSessionId: string | null;
  readonly trigger: AgentRunRecord["trigger"];
  readonly status: AgentRunRecord["status"];
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly stoppedBy: number | null;
  readonly ticket: AgentTask | null;
  readonly thread: AgentThreadItem[];
  readonly task: AgentTaskHelpers | null;
  private readonly operationSequences = new Map<string, number>();
  private firstActivityCallback?: () => void;
  private activityRecorded = false;

  constructor(
    private readonly client: AgentClient,
    context: HydratedContext,
    readonly event: AgentEventName,
    readonly prompt: string | null,
    readonly selection: AgentRun["selection"],
    private readonly deliveryId: string,
    readonly signal: AbortSignal,
  ) {
    this.id = context.record.id;
    this.agentId = context.record.agentId;
    this.taskId = context.record.taskId;
    this.chatSessionId = context.record.chatSessionId;
    this.trigger = context.record.trigger;
    this.status = context.record.status;
    this.createdAt = context.record.createdAt;
    this.lastActivityAt = context.record.lastActivityAt;
    this.stoppedBy = context.record.stoppedBy;
    this.ticket = context.ticket;
    this.thread = context.thread;
    this.task = context.ticket ? this.createTaskHelpers(context.ticket) : null;
  }

  onFirstActivity(callback: () => void): void {
    if (this.activityRecorded) callback();
    else this.firstActivityCallback = callback;
  }

  thought(text: string): Promise<AgentActivity> {
    return this.activity("thought", text);
  }

  action(text: string, link?: string): Promise<AgentActivity> {
    return this.activity("action", text, { link });
  }

  respond(text: string): Promise<AgentActivity> {
    return this.activity("response", text);
  }

  error(text: string): Promise<AgentActivity> {
    return this.activity("error", text);
  }

  ask(
    question: string,
    options: AgentActivityOption[] | { options: AgentActivityOption[] },
  ): Promise<AgentActivity> {
    return this.activity("elicitation", question, {
      options: Array.isArray(options) ? options : options.options,
    });
  }

  automaticThought(): Promise<AgentActivity> {
    return this.activity("thought", "Working on this.", {}, "automatic-thought");
  }

  private nextOperationKey(kind: string): string {
    const sequence = (this.operationSequences.get(kind) ?? 0) + 1;
    this.operationSequences.set(kind, sequence);
    return `${this.deliveryId}:${kind}:${sequence}`;
  }

  private async activity(
    type: AgentActivity["type"],
    text: string,
    extra: { link?: string; options?: AgentActivityOption[] } = {},
    operationKind = `activity-${type}`,
  ): Promise<AgentActivity> {
    const idempotencyKey = this.nextOperationKey(operationKind);
    this.assertNotStopped();
    if (!this.activityRecorded) {
      this.activityRecorded = true;
      this.firstActivityCallback?.();
    }
    await this.assertServerRunActive(this.signal);
    const response = objectValue(
      await this.client.request(
        `/mcp/agents/runs/${encodeURIComponent(this.id)}/activities`,
        {
          method: "POST",
          body: { type, text, ...extra },
          idempotencyKey,
          signal: this.signal,
        },
      ),
      "Agent activity",
    );
    return objectValue(response.activity, "Agent activity") as AgentActivity;
  }

  private assertNotStopped(): void {
    if (this.signal.aborted || this.status === "stopped" || this.status === "done") {
      throw new AgentSdkError("Run is no longer active");
    }
  }

  private async assertServerRunActive(signal: AbortSignal): Promise<void> {
    this.assertNotStopped();
    const response = objectValue(
      await this.client.request(`/mcp/agents/runs/${encodeURIComponent(this.id)}`, {
        signal,
      }),
      "Agent run",
    );
    const run = objectValue(response.run, "Agent run");
    if (run.status === "stopped" || run.status === "done") {
      throw new AgentSdkError("Run is no longer active");
    }
  }

  private async withTaskLease<T>(kind: string, work: (signal: AbortSignal, key: string) => Promise<T>): Promise<T> {
    if (this.taskId === null) throw new AgentSdkError("Run is not attached to a task");
    const taskId = this.taskId;
    const idempotencyKey = this.nextOperationKey(kind);
    const previous = AgentRunImpl.taskLeaseTails.get(taskId) ?? Promise.resolve();
    const operation = previous.then(async () => {
      await this.assertServerRunActive(this.signal);
      await this.client.request("/mcp/tasks/lease/claim", {
        method: "POST",
        body: { task_id: taskId, ttl_seconds: TASK_LEASE_TTL_SECONDS },
        signal: this.signal,
      });

      const operationController = new AbortController();
      const abortOperation = () => operationController.abort(this.signal.reason);
      this.signal.addEventListener("abort", abortOperation, { once: true });
      if (this.signal.aborted) abortOperation();
      let heartbeatError: unknown;
      let heartbeatPromise: Promise<void> | null = null;
      const heartbeat = setInterval(() => {
        if (heartbeatPromise || operationController.signal.aborted) return;
        heartbeatPromise = this.client
          .request("/mcp/tasks/lease/heartbeat", {
            method: "POST",
            body: { task_id: taskId, ttl_seconds: TASK_LEASE_TTL_SECONDS },
            signal: operationController.signal,
          })
          .then(() => undefined)
          .catch((error) => {
            if (operationController.signal.aborted) return;
            heartbeatError = error;
            operationController.abort(error);
          })
          .finally(() => {
            heartbeatPromise = null;
          });
      }, TASK_LEASE_HEARTBEAT_MS);
      (heartbeat as unknown as { unref?: () => void }).unref?.();

      try {
        const result = await work(operationController.signal, idempotencyKey);
        if (heartbeatError) throw heartbeatError;
        return result;
      } finally {
        clearInterval(heartbeat);
        operationController.abort();
        await heartbeatPromise;
        this.signal.removeEventListener("abort", abortOperation);
        await this.client.request("/mcp/tasks/lease/release", {
          method: "POST",
          body: { task_id: taskId },
        }).catch((error) => this.client.reportError(error));
      }
    });
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    AgentRunImpl.taskLeaseTails.set(taskId, tail);
    try {
      return await operation;
    } finally {
      if (AgentRunImpl.taskLeaseTails.get(taskId) === tail) {
        AgentRunImpl.taskLeaseTails.delete(taskId);
      }
    }
  }

  private createTaskHelpers(ticket: AgentTask): AgentTaskHelpers {
    return {
      move: async (section) => {
        let sectionId = section;
        if (typeof section === "string") {
          const response = objectValue(
            await this.client.request(`/mcp/projects/${ticket.projectId}/sections`, {
              signal: this.signal,
            }),
            "Project sections",
          );
          const matches = arrayValue<{ id: number; section_title: string }>(
            response.sections,
            "Project sections",
          ).filter(
            (candidate) =>
              candidate.section_title.trim().toLowerCase() ===
              section.trim().toLowerCase(),
          );
          if (matches.length !== 1) {
            throw new AgentSdkError(
              matches.length === 0
                ? `Section not found: ${section}`
                : `Section name is ambiguous: ${section}`,
            );
          }
          sectionId = matches[0].id;
        }
        return this.withTaskLease("move", (signal, key) =>
          this.client.request("/mcp/tasks/update", {
            method: "POST",
            body: { task_id: ticket.id, sectionId },
            idempotencyKey: key,
            signal,
          }),
        );
      },
      assign: async (assignee) => {
        let assignment: JsonObject;
        if (typeof assignee === "number") {
          assignment = { user_id: assignee };
        } else {
          const reference = assignee.trim();
          if (!reference) throw new AgentSdkError("assignee is required");
          if (reference.toLowerCase() === "me") {
            assignment = { assign_self: true };
          } else if (UUID_PATTERN.test(reference)) {
            assignment = { agent_id: reference };
          } else {
            const response = objectValue(
              await this.client.request(`/mcp/projects/${ticket.projectId}/members`, {
                signal: this.signal,
              }),
              "Project members",
            );
            const normalized = reference.toLowerCase();
            const matches = arrayValue<{
              id: number | string;
              displayName: string;
              email?: string;
            }>(response.members, "Project members").filter(
              (member) =>
                member.displayName.trim().toLowerCase() === normalized ||
                member.email?.trim().toLowerCase() === normalized,
            );
            if (matches.length !== 1) {
              throw new AgentSdkError(
                matches.length === 0
                  ? `Assignee not found: ${reference}`
                  : `Assignee is ambiguous: ${reference}`,
              );
            }
            assignment =
              typeof matches[0].id === "number"
                ? { user_id: matches[0].id }
                : { agent_id: matches[0].id };
          }
        }
        return this.withTaskLease("assign", (signal, key) =>
          this.client.request("/mcp/assignees/assign", {
            method: "POST",
            body: { task_id: ticket.id, intent: "assign", ...assignment },
            idempotencyKey: key,
            signal,
          }),
        );
      },
      comment: (text) =>
        this.withTaskLease("comment", (signal, key) =>
          this.client.request("/mcp/comments", {
            method: "POST",
            body: { task_id: ticket.id, text, content_type: "markdown" },
            idempotencyKey: key,
            signal,
          }),
        ),
      update: (fields: AgentTaskUpdate) =>
        this.withTaskLease("update", (signal, key) =>
          this.client.request("/mcp/tasks/update", {
            method: "POST",
            body: { ...fields, task_id: ticket.id },
            idempotencyKey: key,
            signal,
          }),
        ),
      attach: async (attachment: AgentAttachment) => {
        const spec = typeof attachment === "string" ? { url: attachment } : attachment;
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(spec.url);
        } catch {
          throw new AgentSdkError("Attachment URL is invalid");
        }
        if (
          (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
          parsedUrl.username ||
          parsedUrl.password
        ) {
          throw new AgentSdkError("Attachment URL must be credential-free HTTP(S)");
        }
        let urlFilename: string;
        try {
          urlFilename = decodeURIComponent(
            parsedUrl.pathname.split("/").filter(Boolean).at(-1) ?? "attachment",
          );
        } catch {
          throw new AgentSdkError("Attachment URL has an invalid filename");
        }
        const filename = spec.filename?.trim() || urlFilename;
        const extension = filename.toLowerCase().split(".").at(-1) ?? "";
        const contentType =
          spec.contentType?.split(";")[0].trim().toLowerCase() ||
          ATTACHMENT_CONTENT_TYPES[extension];
        if (!contentType) {
          throw new AgentSdkError(
            "contentType is required when it cannot be inferred from the filename",
          );
        }
        return this.withTaskLease("attach", (signal, key) =>
          this.client.request("/mcp/tasks/attachments", {
            method: "POST",
            body: {
              task_id: ticket.id,
              files: [{ filename, content_type: contentType, url: parsedUrl.toString() }],
            },
            idempotencyKey: key,
            signal,
          }),
        );
      },
    };
  }
}

export function createClient(options: AgentClientOptions): AgentClient {
  return new AgentClient(options.token, options);
}
