export const AGENT_RUN_WEBHOOK_EVENTS = [
  "run.created",
  "run.prompted",
  "run.stopped",
] as const;

export const AGENT_WEBHOOK_EVENTS = [
  "comment.mention",
  "task.assigned",
  "task.unassigned",
  "comment.created",
  "task.updated",
  "task.created",
  "chat.message",
  ...AGENT_RUN_WEBHOOK_EVENTS,
] as const;

export const AGENT_WEBHOOK_EVENT_DEFINITIONS = {
  "comment.mention": {
    subscribable: true,
    description: "Sent when a comment contains a mention addressed to this agent.",
    payload: {
      commentId: "Numeric comment ID.",
      commentHtml: "Stored HTML for the comment containing the mention.",
    },
  },
  "task.assigned": {
    subscribable: true,
    description: "Sent when this agent is assigned to a task.",
    payload: {},
  },
  "task.unassigned": {
    subscribable: true,
    description: "Sent when this agent is removed from a task.",
    payload: {},
  },
  "comment.created": {
    subscribable: true,
    description: "Sent when any comment is added to a task assigned to this agent.",
    payload: {
      commentId: "Numeric comment ID.",
      commentHtml: "Stored HTML for the comment.",
    },
  },
  "task.updated": {
    subscribable: true,
    description: "Sent when a task in this agent's board scope changes section, status, or labels.",
    payload: {
      changes: "Changed fields with their before and after values.",
      labelsRedacted: "True when inconsistent label rows were omitted from changes.",
    },
  },
  "task.created": {
    subscribable: true,
    description: "Sent after a task is created and column auto-assignment has finished in this agent's board scope.",
    payload: {
      assignees: "Final task assignees at creation time.",
      labels: "Labels attached at creation time.",
      labelsRedacted: "True when inconsistent label rows were omitted.",
    },
  },
  "chat.message": {
    subscribable: true,
    label: "Chat message",
    description: "A user sent this agent a message in Agent Chat.",
    payload: {
      chat: "Chat object with sessionId, messageId, text, and userName.",
      agentBrief:
        "Optional bounded snapshot of the agent's current ticket, recent tickets, open pull requests, and recent comments.",
    },
  },
  "run.created": {
    subscribable: true,
    label: "Run created",
    description: "A mention, assignment, or chat message started a run.",
    payload: {
      run: "The newly created run.",
      prompt: "Initial text for mention and chat triggers; null for assignment.",
    },
  },
  "run.prompted": {
    subscribable: true,
    label: "Run prompted",
    description: "A user sent another message to an active or stale run.",
    payload: {
      run: "The reactivated run.",
      prompt: "The new comment HTML or chat text.",
      signal: "select when the prompt came from an elicitation choice.",
      selection: "The chosen elicitation activity, value, and label.",
    },
  },
  "run.stopped": {
    subscribable: true,
    label: "Run stopped",
    description: "A user or the addressed agent stopped a run.",
    payload: {
      run: "The stopped run.",
    },
  },
  "webhook.test": {
    subscribable: false,
    description: "Sent only when a customer explicitly requests a signed test delivery.",
    payload: {
      test: "Always true.",
      message: "Human-readable test-delivery description.",
    },
  },
} as const;

export const AGENT_WEBHOOK_DELIVERY_CONTRACT = {
  documentationUrl: "https://docs.hypertask.ai/mcp/agent-webhooks/",
  method: "POST",
  contentType: "application/json",
  timeoutMs: 5000,
  retriesSeconds: [0, 30, 300, 1800],
  successResponse: "Return any 2xx status within 5 seconds.",
  signing: {
    algorithm: "HMAC-SHA256",
    signedContent: "<X-Hypertask-Timestamp>.<raw request body>",
    signatureFormat: "sha256=<lowercase hex digest>",
  },
  headers: {
    "X-Hypertask-Event": "Event name, including webhook.test for test deliveries.",
    "X-Hypertask-Timestamp": "Unix timestamp used in the signature.",
    "X-Hypertask-Delivery": "Stable delivery ID; deduplicate retries with this value.",
    "X-Hypertask-Signature": "HMAC signature in sha256=<hex> format.",
  },
  commonPayload: {
    event: "Event name.",
    deliveryId: "Stable UUID shared by every retry of this delivery.",
    occurredAt: "ISO 8601 event timestamp.",
    agentId: "Addressed managed-agent UUID.",
    projectId: "Board ID, or null for a test without a board filter.",
    taskId: "Task-only numeric task ID.",
    ticketNumber: "Task-only human-readable ticket number when available.",
    taskTitle: "Task-only task title.",
    actor: "Object with userId, optional agentId, and displayName.",
    runId: "Run UUID on agent-run-enabled interaction and lifecycle events.",
  },
} as const;

export type AgentWebhookEventType = (typeof AGENT_WEBHOOK_EVENTS)[number];

export type AgentWebhookActor = {
  userId: number;
  agentId?: string | null;
  displayName: string;
};

export type AgentWebhookTaskSection = {
  id: number;
  title: string;
};

export type AgentWebhookTaskLabel = {
  id: string;
  value: string | null;
};

export type AgentWebhookTaskAssignee = {
  userId: number;
  agentId: string | null;
};

export type AgentWebhookTaskChanges = {
  section?: {
    from: AgentWebhookTaskSection | null;
    to: AgentWebhookTaskSection | null;
  };
  status?: {
    from: string;
    to: string;
  };
  labels?: {
    from: AgentWebhookTaskLabel[];
    to: AgentWebhookTaskLabel[];
  };
  labelsRedacted?: boolean;
};

export type AgentWebhookChatBriefTicketRef = {
  ticketNumber: string | null;
  title: string;
  url: string;
};

export type AgentWebhookChatBriefTicket = AgentWebhookChatBriefTicketRef & {
  section: string;
  outcome: "open" | "completed" | "archived";
  assignees: string[];
};

export type AgentWebhookChatBrief = {
  currentTicket: AgentWebhookChatBriefTicket | null;
  recentTickets: AgentWebhookChatBriefTicket[];
  openPullRequests: Array<{
    number: number;
    title: string;
    url: string;
    repository: string;
    checkState: string;
    ticket: AgentWebhookChatBriefTicketRef;
  }>;
  recentComments: Array<{
    text: string;
    createdAt: string;
    ticket: AgentWebhookChatBriefTicketRef;
  }>;
};

/** Board-free chat context, present only on chat.message deliveries. */
export type AgentWebhookChat = {
  sessionId: string;
  messageId: string;
  text: string;
  userName: string | null;
};

export type AgentWebhookRun = {
  id: string;
  agentId: string;
  taskId: number | null;
  chatSessionId: string | null;
  trigger: "mention" | "assigned" | "chat";
  status:
    | "queued"
    | "active"
    | "stale"
    | "stopped"
    | "done"
    | "failed"
    | "expired";
  createdAt: string;
  lastActivityAt: string;
  stoppedBy: number | null;
};

export type AgentWebhookEventInput = {
  event: AgentWebhookEventType;
  agentId: string;
  // A chat.message is not board scoped, so its board and task fields are null.
  projectId: number | null;
  taskId: number | null;
  ticketNumber: string | null;
  taskTitle: string | null;
  actor: AgentWebhookActor;
  runId?: string;
  run?: AgentWebhookRun;
  prompt?: string | null;
  signal?: "select";
  selection?: {
    activityId: string;
    value: string;
    label: string;
  };
  chat?: AgentWebhookChat;
  agentBrief?: AgentWebhookChatBrief;
  commentId?: number;
  commentHtml?: string;
  changes?: AgentWebhookTaskChanges;
  assignees?: AgentWebhookTaskAssignee[];
  labels?: AgentWebhookTaskLabel[];
  labelsRedacted?: boolean;
};

export type AgentWebhookPayload = AgentWebhookEventInput & {
  deliveryId: string;
  occurredAt: string;
};

export function availableAgentWebhookEvents(
  agentRunsEnabled: boolean,
): AgentWebhookEventType[] {
  return agentRunsEnabled
    ? [...AGENT_WEBHOOK_EVENTS]
    : AGENT_WEBHOOK_EVENTS.filter(
        (event) =>
          !(AGENT_RUN_WEBHOOK_EVENTS as readonly string[]).includes(event),
      );
}

export function availableAgentWebhookEventDefinitions(
  agentRunsEnabled: boolean,
): Partial<typeof AGENT_WEBHOOK_EVENT_DEFINITIONS> {
  const available = new Set(availableAgentWebhookEvents(agentRunsEnabled));
  return Object.fromEntries(
    Object.entries(AGENT_WEBHOOK_EVENT_DEFINITIONS).filter(
      ([event]) => event === "webhook.test" || available.has(event as AgentWebhookEventType),
    ),
  ) as Partial<typeof AGENT_WEBHOOK_EVENT_DEFINITIONS>;
}

export function parseAgentWebhookEvents(
  value: unknown,
  availableEvents: readonly AgentWebhookEventType[] = AGENT_WEBHOOK_EVENTS,
):
  | { ok: true; events: AgentWebhookEventType[] }
  | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, events: [...availableEvents] };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "events must be a non-empty array" };
  }

  const unique = [...new Set(value)];
  if (
    unique.some(
      (event) =>
        typeof event !== "string" ||
        !(availableEvents as readonly string[]).includes(event),
    )
  ) {
    return {
      ok: false,
      error: `events may only contain: ${availableEvents.join(", ")}`,
    };
  }
  return { ok: true, events: unique as AgentWebhookEventType[] };
}
