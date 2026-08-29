export const AGENT_WEBHOOK_EVENTS = [
  "comment.mention",
  "task.assigned",
  "task.unassigned",
  "comment.created",
  "task.updated",
  "task.created",
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
    actor: "Task-only object with userId, optional agentId, and displayName.",
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

export type AgentWebhookEventInput = {
  event: AgentWebhookEventType;
  agentId: string;
  projectId: number;
  taskId: number;
  ticketNumber: string | null;
  taskTitle: string;
  actor: AgentWebhookActor;
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

export function parseAgentWebhookEvents(value: unknown):
  | { ok: true; events: AgentWebhookEventType[] }
  | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, events: [...AGENT_WEBHOOK_EVENTS] };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "events must be a non-empty array" };
  }

  const unique = [...new Set(value)];
  if (
    unique.some(
      (event) =>
        typeof event !== "string" ||
        !(AGENT_WEBHOOK_EVENTS as readonly string[]).includes(event),
    )
  ) {
    return {
      ok: false,
      error: `events may only contain: ${AGENT_WEBHOOK_EVENTS.join(", ")}`,
    };
  }
  return { ok: true, events: unique as AgentWebhookEventType[] };
}
