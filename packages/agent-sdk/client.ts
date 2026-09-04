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
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function responseMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const body = value as JsonObject;
  return typeof body.message === "string" && body.message
    ? body.message
    : typeof body.error === "string" && body.error
      ? body.error
      : fallback;
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
  return Number.isFinite(difference) && difference !== 0
    ? difference
    : String(a.id).localeCompare(String(b.id));
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

  constructor(
    private readonly token: string,
    options: Omit<AgentClientOptions, "token"> = {},
  ) {
    if (!token.trim()) throw new AgentSdkError("token is required");
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

    const text = await response.text();
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
      this.onErrorCallback(error, payload);
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
    if (event === "stop") this.activeRuns.get(preflightRun.id)?.controller.abort();
    const execution = this.acquireRun(preflightRun.id, event === "stop");
    const abortForLostClaim = () => execution.controller.abort(claimSignal?.reason);
    claimSignal?.addEventListener("abort", abortForLostClaim, { once: true });
    if (claimSignal?.aborted) abortForLostClaim();

    try {
      const context = await this.hydrateContext(
        preflightRun,
        event === "stop" ? claimSignal : execution.controller.signal,
      );
      const run = new AgentRunImpl(
        this,
        context,
        event,
        typeof payload.prompt === "string" ? payload.prompt : null,
        payload.signal === "select" && payload.selection ? payload.selection : null,
        payload.deliveryId,
        execution.controller.signal,
      );
      const handlers = [
        ...(this.handlers.get(event) ?? []),
        ...(this.handlers.get("*") ?? []),
      ];

      let autoThoughtDone = Promise.resolve();
      let cancelAutoThought = () => {};
      if (event !== "stop") {
        autoThoughtDone = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            run.thought("Working on this.").then(() => resolve(), reject);
          }, AUTO_THOUGHT_MS);
          (timer as unknown as { unref?: () => void }).unref?.();
          cancelAutoThought = () => {
            clearTimeout(timer);
            resolve();
          };
          run.onFirstActivity(cancelAutoThought);
        });
      }

      try {
        for (const handler of handlers) await handler(run);
        await autoThoughtDone;
      } catch (error) {
        cancelAutoThought();
        throw error;
      }
    } finally {
      claimSignal?.removeEventListener("abort", abortForLostClaim);
      execution.release();
    }
  }

  private acquireRun(runId: string, stopped: boolean) {
    let active = this.activeRuns.get(runId);
    if (!active || active.controller.signal.aborted) {
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
    const activitiesPromise = this.request<{ activities: AgentActivity[] }>(
      `/mcp/agents/runs/${encodeURIComponent(record.id)}/activities`,
      { signal },
    ).then((response) =>
      response.activities.map((activity) => ({
        kind: "activity" as const,
        ...activity,
      })),
    );

    if (record.taskId !== null) {
      const [taskResponse, commentResponse, activities] = await Promise.all([
        this.request<{ task?: AgentTask; tasks?: AgentTask[] }>(
          `/mcp/tasks?task_id=${record.taskId}`,
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
        }>(`/mcp/comments?task_id=${record.taskId}&limit=100&sort_order=desc`, {
          signal,
        }),
        activitiesPromise,
      ]);
      const ticket = taskResponse.task ?? taskResponse.tasks?.[0] ?? null;
      if (!ticket || ticket.id !== record.taskId) {
        throw new AgentSdkError("Run task is unavailable to this agent token");
      }
      const comments: AgentThreadItem[] = commentResponse.comments.map((comment) => ({
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

    if (record.chatSessionId !== null) {
      const [chatResponse, activities] = await Promise.all([
        this.request<{
          messages: Array<{
            id: string;
            role: "human" | "assistant";
            content: string;
            createdAt: string;
          }>;
        }>(
          `/mcp/chat/sessions/${encodeURIComponent(record.chatSessionId)}/messages`,
          { signal },
        ),
        activitiesPromise,
      ]);
      const messages: AgentThreadItem[] = chatResponse.messages.map((message) => ({
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

    throw new AgentSdkError("Agent run has no task or chat context");
  }

  async externalHead(url: string, signal: AbortSignal): Promise<Response> {
    return this.requestFetch(url, { method: "HEAD", redirect: "follow", signal });
  }
}

class AgentRunImpl implements AgentRun {
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
  private operationSequence = 0;
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
    Object.assign(this, context.record);
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

  private nextOperationKey(kind: string): string {
    this.operationSequence += 1;
    return `${this.deliveryId}:${this.operationSequence}:${kind}`;
  }

  private async activity(
    type: AgentActivity["type"],
    text: string,
    extra: { link?: string; options?: AgentActivityOption[] } = {},
  ): Promise<AgentActivity> {
    this.assertNotStopped();
    const response = await this.client.request<{ activity: AgentActivity }>(
      `/mcp/agents/runs/${encodeURIComponent(this.id)}/activities`,
      {
        method: "POST",
        body: { type, text, ...extra },
        idempotencyKey: this.nextOperationKey(`activity-${type}`),
        signal: this.signal,
      },
    );
    if (!this.activityRecorded) {
      this.activityRecorded = true;
      this.firstActivityCallback?.();
    }
    return response.activity;
  }

  private assertNotStopped(): void {
    if (this.signal.aborted || this.status === "stopped" || this.status === "done") {
      throw new AgentSdkError("Run is no longer active");
    }
  }

  private async assertServerRunActive(signal: AbortSignal): Promise<void> {
    this.assertNotStopped();
    const response = await this.client.request<{ run: AgentRunRecord }>(
      `/mcp/agents/runs/${encodeURIComponent(this.id)}`,
      { signal },
    );
    if (response.run.status === "stopped" || response.run.status === "done") {
      throw new AgentSdkError("Run is no longer active");
    }
  }

  private async withTaskLease<T>(kind: string, work: (signal: AbortSignal, key: string) => Promise<T>): Promise<T> {
    if (this.taskId === null) throw new AgentSdkError("Run is not attached to a task");
    await this.assertServerRunActive(this.signal);
    await this.client.request("/mcp/tasks/lease/claim", {
      method: "POST",
      body: { task_id: this.taskId, ttl_seconds: TASK_LEASE_TTL_SECONDS },
      signal: this.signal,
    });

    const operationController = new AbortController();
    const abortOperation = () => operationController.abort(this.signal.reason);
    this.signal.addEventListener("abort", abortOperation, { once: true });
    let heartbeatError: unknown;
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || operationController.signal.aborted) return;
      heartbeatRunning = true;
      this.client.request("/mcp/tasks/lease/heartbeat", {
        method: "POST",
        body: { task_id: this.taskId, ttl_seconds: TASK_LEASE_TTL_SECONDS },
        signal: operationController.signal,
      }).catch((error) => {
        heartbeatError = error;
        operationController.abort(error);
      }).finally(() => {
        heartbeatRunning = false;
      });
    }, TASK_LEASE_HEARTBEAT_MS);
    (heartbeat as unknown as { unref?: () => void }).unref?.();

    try {
      const result = await work(operationController.signal, this.nextOperationKey(kind));
      if (heartbeatError) throw heartbeatError;
      return result;
    } finally {
      clearInterval(heartbeat);
      this.signal.removeEventListener("abort", abortOperation);
      await this.client.request("/mcp/tasks/lease/release", {
        method: "POST",
        body: { task_id: this.taskId },
      }).catch((error) => this.client.reportError(error));
    }
  }

  private createTaskHelpers(ticket: AgentTask): AgentTaskHelpers {
    return {
      move: async (section) => {
        let sectionId = section;
        if (typeof section === "string") {
          const response = await this.client.request<{
            sections: Array<{ id: number; section_title: string }>;
          }>(`/mcp/projects/${ticket.projectId}/sections`);
          const matches = response.sections.filter(
            (candidate) =>
              candidate.section_title.trim().toLocaleLowerCase() ===
              section.trim().toLocaleLowerCase(),
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
          if (reference.toLocaleLowerCase() === "me") {
            assignment = { assign_self: true };
          } else if (UUID_PATTERN.test(reference)) {
            assignment = { agent_id: reference };
          } else {
            const response = await this.client.request<{
              members: Array<{
                id: number | string;
                displayName: string;
                email?: string;
              }>;
            }>(`/mcp/projects/${ticket.projectId}/members`);
            const normalized = reference.toLocaleLowerCase();
            const matches = response.members.filter(
              (member) =>
                member.displayName.trim().toLocaleLowerCase() === normalized ||
                member.email?.trim().toLocaleLowerCase() === normalized,
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
        return this.withTaskLease("assign", (signal) =>
          this.client.request("/mcp/assignees/assign", {
            method: "POST",
            body: { task_id: ticket.id, intent: "assign", ...assignment },
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
            body: { task_id: ticket.id, ...fields },
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
        const filename =
          spec.filename?.trim() ||
          decodeURIComponent(parsedUrl.pathname.split("/").filter(Boolean).at(-1) ?? "attachment");
        let contentType = spec.contentType?.split(";")[0].trim().toLocaleLowerCase();
        if (!contentType) {
          const head = await this.client.externalHead(parsedUrl.toString(), this.signal);
          if (!head.ok) {
            throw new AgentSdkError(`Attachment URL returned HTTP ${head.status}`);
          }
          contentType = head.headers.get("content-type")?.split(";")[0].trim().toLocaleLowerCase();
        }
        if (!contentType) {
          throw new AgentSdkError("Attachment content type is unavailable");
        }
        return this.withTaskLease("attach", (signal) =>
          this.client.request("/mcp/tasks/attachments", {
            method: "POST",
            body: {
              task_id: ticket.id,
              files: [{ filename, content_type: contentType, url: parsedUrl.toString() }],
            },
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
