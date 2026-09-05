export type AgentEventName = "mention" | "assigned" | "chat" | "prompted" | "stop";
export type AgentEventSubscription = AgentEventName | "*";
export type AgentRunStatus = "active" | "stale" | "stopped" | "done";
export type AgentRunTrigger = "mention" | "assigned" | "chat";
export type AgentActivityType =
  | "thought"
  | "action"
  | "response"
  | "error"
  | "elicitation";

export type AgentRunRecord = {
  id: string;
  agentId: string;
  taskId: number | null;
  chatSessionId: string | null;
  trigger: AgentRunTrigger;
  status: AgentRunStatus;
  createdAt: string;
  lastActivityAt: string;
  stoppedBy: number | null;
};

export type AgentActivityOption = { value: string; label: string };

export type AgentRunSelection = AgentActivityOption & {
  activityId: string;
};

export type AgentActivity = {
  id: string;
  runId: string;
  type: AgentActivityType;
  text: string;
  link: string | null;
  options: AgentActivityOption[] | null;
  selectedOption: AgentActivityOption | null;
  selectedAt: string | null;
  selectedBy: number | null;
  createdAt: string;
};

export type AgentTask = {
  id: number;
  ticketNumber?: string;
  title: string;
  description: string;
  section: string;
  sectionId?: number;
  boardId: number;
  boardTitle: string;
  projectId: number;
  status: "Normal" | "Archive" | "Deleted";
  priority?: string;
  dueDate?: string;
  assignees: unknown[];
  labels: unknown[];
  createdAt: string;
  updatedAt?: string;
};

export type AgentThreadItem =
  | {
      kind: "comment";
      id: number;
      text: string;
      createdAt: string;
      creator?: unknown;
      agent?: unknown;
    }
  | {
      kind: "message";
      id: string;
      text: string;
      role: "human" | "assistant";
      createdAt: string;
    }
  | ({ kind: "activity" } & AgentActivity);

export type AgentTaskUpdate = {
  title?: string;
  description?: string;
  content_type?: "html" | "markdown";
  priority?: number | string;
  estimate?: number;
  sectionId?: number;
  status?: "Normal" | "Archive" | "Deleted";
  labels?: Array<string | number>;
  add_labels?: Array<string | number>;
  remove_labels?: Array<string | number>;
  due_date?: string | null;
  assignee?: number[];
  parent_task_id?: number | null;
  risk_level?: string;
  acceptance_criteria?: string;
  verify_command?: string;
  pull_request_url?: string;
};

export type AgentAttachment =
  | string
  | { url: string; filename?: string; contentType?: string };

export interface AgentTaskHelpers {
  move(section: string | number): Promise<unknown>;
  assign(assignee: number | string): Promise<unknown>;
  comment(text: string): Promise<unknown>;
  update(fields: AgentTaskUpdate): Promise<unknown>;
  attach(attachment: AgentAttachment): Promise<unknown>;
}

export interface AgentRun extends AgentRunRecord {
  event: AgentEventName;
  prompt: string | null;
  selection: AgentRunSelection | null;
  ticket: AgentTask | null;
  thread: AgentThreadItem[];
  signal: AbortSignal;
  task: AgentTaskHelpers | null;
  thought(text: string): Promise<AgentActivity>;
  action(text: string, link?: string): Promise<AgentActivity>;
  respond(text: string): Promise<AgentActivity>;
  error(text: string): Promise<AgentActivity>;
  ask(
    question: string,
    options: AgentActivityOption[] | { options: AgentActivityOption[] },
  ): Promise<AgentActivity>;
}

export type AgentEventHandler = (run: AgentRun) => void | Promise<void>;

export type DeliveryClaim = {
  deliveryId: string;
  owner: string;
  leaseUntil: number;
};

export interface DeliveryStore {
  /** True only when claims are shared durably by every runtime instance. */
  readonly durable: boolean;
  claim(claim: DeliveryClaim): Promise<"claimed" | "processing" | "completed">;
  renew(claim: DeliveryClaim): Promise<boolean>;
  complete(claim: DeliveryClaim, retainUntil: number): Promise<boolean>;
  release(claim: DeliveryClaim): Promise<boolean>;
}

export type AgentWebhookPayload = {
  event: string;
  deliveryId: string;
  occurredAt?: string;
  agentId: string;
  projectId: number | null;
  taskId: number | null;
  ticketNumber?: string | null;
  taskTitle?: string | null;
  runId?: string;
  run?: AgentRunRecord;
  prompt?: string | null;
  signal?: "select";
  selection?: AgentRunSelection;
  chat?: {
    sessionId: string;
    messageId: string;
    text: string;
    userName: string | null;
  };
  [key: string]: unknown;
};

export type DeliveryScheduler = {
  /** Persist and dedupe the delivery before resolving; retry `run` until it succeeds. */
  enqueue(input: {
    deliveryId: string;
    payload: AgentWebhookPayload;
    run: () => Promise<void>;
  }): Promise<"enqueued" | "duplicate">;
};

export type BackgroundContext = {
  scheduler?: DeliveryScheduler;
  /** Set for horizontally scaled or restartable request runtimes. */
  distributed?: boolean;
};

export interface WebhookHandler {
  (request: Request, context?: BackgroundContext): Promise<Response>;
  readonly deliveryStore: DeliveryStore;
  readonly scheduler?: DeliveryScheduler;
  /** Process a payload recovered by the configured durable scheduler. */
  processDelivery(payload: AgentWebhookPayload): Promise<void>;
}

export type AgentOptions = {
  token: string;
  webhookSecret: string;
  apiUrl?: string;
  fetch?: typeof globalThis.fetch;
  deliveryStore?: DeliveryStore;
  scheduler?: DeliveryScheduler;
  onError?: (error: unknown, payload?: AgentWebhookPayload) => void;
  /**
   * Preview mode: every write the SDK would send is printed and skipped, reads
   * still hit the API. Defaults to true when HYPERTASK_DRY_RUN is set to 1 or
   * true. Also lets a finished run be replayed locally, which the liveness
   * guards would otherwise reject.
   */
  dryRun?: boolean;
  /** Where dry-run previews go. Defaults to console.log. */
  onDryRun?: (preview: DryRunWrite) => void;
};

export type DryRunWrite = {
  method: string;
  path: string;
  body: unknown;
  idempotencyKey?: string;
};

export type AgentClientOptions = Omit<
  AgentOptions,
  "webhookSecret" | "deliveryStore" | "scheduler"
>;
