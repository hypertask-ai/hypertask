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
  DryRunWrite,
} from "./types.js";

const DEFAULT_API_URL = "https://api.hypertask.ai/api";
const TASK_LEASE_TTL_SECONDS = 300;
const TASK_LEASE_HEARTBEAT_MS = 60_000;
const TASK_LEASE_RELEASE_TIMEOUT_MS = 5_000;
const AUTO_THOUGHT_MS = 8_000;
const RUN_STATUS_POLL_MS = 5_000;
const RUN_STOP_TOMBSTONE_MS = 24 * 60 * 60 * 1000;
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

function envDryRun(): boolean {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.HYPERTASK_DRY_RUN;
  return value === "1" || value === "true";
}

/**
 * A write is never sent in dry-run mode, so the SDK answers itself with the
 * smallest response each caller accepts. Only the lease claim and the activity
 * write read anything back; every other write ignores the body.
 */
function dryRunResponse(path: string, body: unknown): unknown {
  const sent = (body && typeof body === "object" && !Array.isArray(body)
    ? (body as JsonObject)
    : {}) as JsonObject;
  if (path.endsWith("/lease/claim")) {
    return {
      success: true,
      lease: { taskId: sent.task_id, leaseToken: sent.lease_token },
    };
  }
  if (path.endsWith("/activities")) {
    const now = new Date().toISOString();
    return {
      success: true,
      activity: {
        id: `dry-run-${globalThis.crypto.randomUUID()}`,
        runId: path.split("/").slice(-2)[0],
        type: sent.type,
        text: sent.text,
        link: sent.link ?? null,
        options: sent.options ?? null,
        selectedOption: null,
        selectedAt: null,
        selectedBy: null,
        createdAt: now,
      },
    };
  }
  return { success: true };
}

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
  if (
    !Array.isArray(value) ||
    value.some((item) => !item || typeof item !== "object" || Array.isArray(item))
  ) {
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
  const aTime = Date.parse(a.createdAt);
  const bTime = Date.parse(b.createdAt);
  if (Number.isFinite(aTime) !== Number.isFinite(bTime)) {
    return Number.isFinite(aTime) ? -1 : 1;
  }
  if (Number.isFinite(aTime) && aTime !== bTime) return aTime - bTime;
  if (typeof a.id === "number" && typeof b.id === "number") return a.id - b.id;
  if (typeof a.id !== typeof b.id) return typeof a.id === "number" ? -1 : 1;
  return String(a.id).localeCompare(String(b.id));
}

export class AgentClient {
  private readonly baseUrl: string;
  private readonly requestFetch: typeof globalThis.fetch;
  private readonly handlers = new Map<AgentEventSubscription, Set<AgentEventHandler>>();
  private readonly activeRuns = new Map<
    string,
    {
      controller: AbortController;
      references: number;
      cleanupTimer?: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly onErrorCallback?: AgentClientOptions["onError"];
  private readonly onDryRunCallback?: AgentClientOptions["onDryRun"];
  /** True while writes are previewed instead of sent. */
  readonly dryRun: boolean;

  private readonly token: string;

  constructor(token: string, options: Omit<AgentClientOptions, "token"> = {}) {
    if (typeof token !== "string" || !token.trim()) {
      throw new AgentSdkError("token is required");
    }
    this.token = token.trim();
    this.baseUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.requestFetch = options.fetch ?? globalThis.fetch;
    if (typeof this.requestFetch !== "function") {
      throw new AgentSdkError("A Fetch API implementation is required");
    }
    this.onErrorCallback = options.onError;
    this.onDryRunCallback = options.onDryRun;
    this.dryRun = options.dryRun ?? envDryRun();
  }

  private previewWrite(write: DryRunWrite): void {
    if (this.onDryRunCallback) {
      this.onDryRunCallback(write);
      return;
    }
    console.log(
      `[dry-run] ${write.method} ${write.path} ${JSON.stringify(write.body ?? {})}`,
    );
  }

  on(event: AgentEventSubscription, handler: AgentEventHandler): () => void {
    const handlers = this.handlers.get(event) ?? new Set<AgentEventHandler>();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    if (this.dryRun && method !== "GET") {
      this.previewWrite({
        method,
        path,
        body: options.body ?? null,
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      });
      return dryRunResponse(path, options.body) as T;
    }
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
      "X-Hypertask-Agent-SDK": "typescript",
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
        method,
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
          payload.run.chatSessionId !== run.chatSessionId ||
          payload.run.trigger !== run.trigger))
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
      // A dry run replays recorded work, so a finished run is the normal case.
      if (
        !this.dryRun &&
        (runRecord.status === "stopped" || runRecord.status === "done")
      ) {
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
      event === "stop" || this.dryRun
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
        for (const handler of handlers) {
          if (claimError) throw claimError;
          if (statusCheckError) throw statusCheckError;
          if (event !== "stop") dispatchController.signal.throwIfAborted();
          await handler(run);
        }
        cancelAutoThought();
        await autoThoughtDone;
        if (autoThoughtFailed) throw autoThoughtError;
      } catch (error) {
        dispatchController.abort(error);
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
        if (current.references !== 0) return;
        if (!current.controller.signal.aborted) {
          this.activeRuns.delete(runId);
          return;
        }
        if (current.cleanupTimer) return;
        current.cleanupTimer = setTimeout(() => {
          const tombstone = this.activeRuns.get(runId);
          if (!tombstone || tombstone.controller !== current.controller) return;
          tombstone.cleanupTimer = undefined;
          if (tombstone.references === 0) this.activeRuns.delete(runId);
        }, RUN_STOP_TOMBSTONE_MS);
        (current.cleanupTimer as unknown as { unref?: () => void }).unref?.();
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
        ...activity,
        kind: "activity" as const,
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
  // Same-client operations for one task cannot overlap because lease ownership is agent-scoped.
  private static readonly taskLeaseTails = new WeakMap<
    AgentClient,
    Map<number, Promise<void>>
  >();

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
    if (this.signal.aborted) throw new AgentSdkError("Run is no longer active");
    // A dry run never writes, so a recorded run stays replayable after it ended.
    if (this.client.dryRun) return;
    if (this.status === "stopped" || this.status === "done") {
      throw new AgentSdkError("Run is no longer active");
    }
  }

  private async assertServerRunActive(signal: AbortSignal): Promise<void> {
    this.assertNotStopped();
    if (this.client.dryRun) return;
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

  private async releaseTaskLease(taskId: number, leaseToken: string): Promise<void> {
    const releaseController = new AbortController();
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const releaseTimeout = new Promise<never>((_, reject) => {
      releaseTimer = setTimeout(() => {
        releaseController.abort();
        reject(new AgentSdkError("Task lease release timed out"));
      }, TASK_LEASE_RELEASE_TIMEOUT_MS);
      (releaseTimer as unknown as { unref?: () => void }).unref?.();
    });
    await Promise.race([
      this.client.request("/mcp/tasks/lease/release", {
        method: "POST",
        body: { task_id: taskId, lease_token: leaseToken },
        signal: releaseController.signal,
      }),
      releaseTimeout,
    ])
      .catch((error) => this.client.reportError(error))
      .finally(() => clearTimeout(releaseTimer));
  }

  private async withTaskLease<T>(kind: string, work: (signal: AbortSignal, key: string) => Promise<T>): Promise<T> {
    if (this.taskId === null) throw new AgentSdkError("Run is not attached to a task");
    const taskId = this.taskId;
    const idempotencyKey = this.nextOperationKey(kind);
    const leaseToken = globalThis.crypto.randomUUID();
    let leaseTails = AgentRunImpl.taskLeaseTails.get(this.client);
    if (!leaseTails) {
      leaseTails = new Map<number, Promise<void>>();
      AgentRunImpl.taskLeaseTails.set(this.client, leaseTails);
    }
    const previous = leaseTails.get(taskId) ?? Promise.resolve();
    const operation = previous.then(async () => {
      await this.assertServerRunActive(this.signal);
      let claimResponse: unknown;
      try {
        claimResponse = await this.client.request("/mcp/tasks/lease/claim", {
          method: "POST",
          body: {
            task_id: taskId,
            ttl_seconds: TASK_LEASE_TTL_SECONDS,
            lease_token: leaseToken,
          },
          signal: this.signal,
        });
      } catch (error) {
        const logicalFailure =
          error instanceof AgentSdkError &&
          error.response !== null &&
          typeof error.response === "object" &&
          !Array.isArray(error.response) &&
          (error.response as JsonObject).success === false;
        const explicitDenial =
          logicalFailure &&
          error instanceof AgentSdkError &&
          error.status !== undefined &&
          error.status < 500;
        // The per-claim token makes cleanup safe when commit status is unknown.
        if (
          error instanceof AgentSdkError &&
          !explicitDenial &&
          (error.status === undefined ||
            (error.status >= 200 && error.status < 300) ||
            error.status >= 500)
        ) {
          await this.releaseTaskLease(taskId, leaseToken);
        }
        throw error;
      }
      try {
        const response = objectValue(claimResponse, "Task lease claim");
        const lease = objectValue(response.lease, "Task lease claim");
        if (
          response.success !== true ||
          lease.taskId !== taskId ||
          lease.leaseToken !== leaseToken
        ) {
          throw new AgentSdkError("Task lease claim returned an invalid response");
        }
      } catch (error) {
        await this.releaseTaskLease(taskId, leaseToken);
        throw error;
      }

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
            body: {
              task_id: taskId,
              ttl_seconds: TASK_LEASE_TTL_SECONDS,
              lease_token: leaseToken,
            },
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
        await this.releaseTaskLease(taskId, leaseToken);
      }
    });
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    leaseTails.set(taskId, tail);
    try {
      return await operation;
    } finally {
      if (leaseTails.get(taskId) === tail) {
        leaseTails.delete(taskId);
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
          const sections = arrayValue<{ id: number; section_title: string }>(
            response.sections,
            "Project sections",
          );
          if (
            sections.some(
              (candidate) =>
                typeof candidate.id !== "number" ||
                typeof candidate.section_title !== "string",
            )
          ) {
            throw new AgentSdkError("Project sections returned an invalid response");
          }
          const matches = sections.filter(
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
            const members = arrayValue<{
              id: number | string;
              displayName: string;
              email?: string;
            }>(response.members, "Project members");
            if (
              members.some(
                (member) =>
                  (typeof member.id !== "number" && typeof member.id !== "string") ||
                  typeof member.displayName !== "string" ||
                  (member.email !== undefined && typeof member.email !== "string"),
              )
            ) {
              throw new AgentSdkError("Project members returned an invalid response");
            }
            const matches = members.filter(
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
