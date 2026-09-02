// Board events an outbound webhook may subscribe to (HTPR-4434, HTPR-5168).
//
// Delivery is durable (HTPR-4530): the emitting controllers write a
// BoardWebhookDelivery outbox row and a QStash handler retries it with bounded
// exponential backoff under a stable delivery id. See webhooks/outbox.ts.
//
// task.updated fires for section, status, and dueDate changes. Priority is
// written from several unrelated controllers rather than one choke point, so
// it is not part of the change contract; wiring it is tracked separately.
export const WEBHOOK_EVENTS = [
  'comment.created',
  'task.escalated',
  'task.created',
  'task.assigned',
  'task.updated',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]

export type WebhookActor = {
  userId: number | null
  agentId: string | null
}

export type WebhookTaskReference = {
  id: number
  ticketNumber: string | null
  projectId: number
  title: string
}

export type WebhookTaskSection = {
  id: number
  title: string
}

export type WebhookTaskPriority = {
  id: string
  index: number
  value: string
}

export type WebhookTaskStatus = 'Normal' | 'Archive' | 'Deleted'

export type WebhookTaskState = {
  section: WebhookTaskSection | null
  status: WebhookTaskStatus
  priority: WebhookTaskPriority | null
  dueDate: string | null
  startDate: string | null
}

type RequireAtLeastOne<T> = {
  [Key in keyof T]-?: Required<Pick<T, Key>> & Partial<Omit<T, Key>>
}[keyof T]

export type WebhookTaskChanges = RequireAtLeastOne<{
  section: {
    from: WebhookTaskSection | null
    to: WebhookTaskSection | null
  }
  status: { from: WebhookTaskStatus; to: WebhookTaskStatus }
  dueDate: { from: string | null; to: string | null }
}>

export type WebhookEventPayloadMap = {
  'comment.created': {
    task: WebhookTaskReference
    comment: { id: number; text: string; createdAt: string }
    actor: WebhookActor
  }
  'task.escalated': {
    task: WebhookTaskReference
    reason: string | null
    actor: WebhookActor
  }
  'task.created': {
    task: WebhookTaskReference
    state: WebhookTaskState
    actor: WebhookActor
  }
  'task.assigned': {
    task: WebhookTaskReference
    action: 'assigned' | 'unassigned'
    assignee: {
      userId: number
      // Present for agent assignments so a runner can filter without another
      // API request. Null means the assignee is the human user directly.
      agentId: string | null
    }
    actor: WebhookActor
  }
  'task.updated': {
    task: WebhookTaskReference
    changes: WebhookTaskChanges
    actor: WebhookActor
  }
}

export type WebhookEventPayload<T extends WebhookEventType> =
  WebhookEventPayloadMap[T]

export type WebhookDeliveryPayloadMap = WebhookEventPayloadMap & {
  ping: { projectId: number; message: string }
}

export type WebhookDeliveryEventType = keyof WebhookDeliveryPayloadMap

export type WebhookDelivery<
  T extends WebhookDeliveryEventType = WebhookDeliveryEventType,
> = {
  [Event in T]: {
    event: Event
    data: WebhookDeliveryPayloadMap[Event]
  }
}[T]

export type WebhookEnvelope<
  T extends WebhookDeliveryEventType = WebhookDeliveryEventType,
> = {
  [Event in T]: {
    id: string
    event: Event
    deliveredAt: string
    data: WebhookDeliveryPayloadMap[Event]
  }
}[T]

function sanitizeTaskReference(
  task: WebhookTaskReference
): WebhookTaskReference {
  return {
    id: task.id,
    ticketNumber: task.ticketNumber,
    projectId: task.projectId,
    title: task.title,
  }
}

function sanitizeActor(actor: WebhookActor): WebhookActor {
  return { userId: actor.userId, agentId: actor.agentId }
}

function sanitizeSection(
  section: WebhookTaskSection | null
): WebhookTaskSection | null {
  return section ? { id: section.id, title: section.title } : null
}

function sanitizePriority(
  priority: WebhookTaskPriority | null
): WebhookTaskPriority | null {
  return priority
    ? { id: priority.id, index: priority.index, value: priority.value }
    : null
}

function sanitizeTaskChanges(
  changes: WebhookTaskChanges
): WebhookTaskChanges {
  const sanitized: Partial<{
    section: { from: WebhookTaskSection | null; to: WebhookTaskSection | null }
    status: { from: WebhookTaskStatus; to: WebhookTaskStatus }
    dueDate: { from: string | null; to: string | null }
  }> = {}

  if (changes.section !== undefined) {
    sanitized.section = {
      from: sanitizeSection(changes.section.from),
      to: sanitizeSection(changes.section.to),
    }
  }
  if (changes.status !== undefined) {
    sanitized.status = {
      from: changes.status.from,
      to: changes.status.to,
    }
  }
  if (changes.dueDate !== undefined) {
    sanitized.dueDate = {
      from: changes.dueDate.from,
      to: changes.dueDate.to,
    }
  }

  return sanitized as WebhookTaskChanges
}

function sanitizeWebhookDelivery(delivery: WebhookDelivery): WebhookDelivery {
  switch (delivery.event) {
    case 'ping':
      return {
        event: delivery.event,
        data: {
          projectId: delivery.data.projectId,
          message: delivery.data.message,
        },
      }
    case 'comment.created':
      return {
        event: delivery.event,
        data: {
          task: sanitizeTaskReference(delivery.data.task),
          comment: {
            id: delivery.data.comment.id,
            text: delivery.data.comment.text,
            createdAt: delivery.data.comment.createdAt,
          },
          actor: sanitizeActor(delivery.data.actor),
        },
      }
    case 'task.escalated':
      return {
        event: delivery.event,
        data: {
          task: sanitizeTaskReference(delivery.data.task),
          reason: delivery.data.reason,
          actor: sanitizeActor(delivery.data.actor),
        },
      }
    case 'task.created':
      return {
        event: delivery.event,
        data: {
          task: sanitizeTaskReference(delivery.data.task),
          state: {
            section: sanitizeSection(delivery.data.state.section),
            status: delivery.data.state.status,
            priority: sanitizePriority(delivery.data.state.priority),
            dueDate: delivery.data.state.dueDate,
            startDate: delivery.data.state.startDate,
          },
          actor: sanitizeActor(delivery.data.actor),
        },
      }
    case 'task.assigned':
      return {
        event: delivery.event,
        data: {
          task: sanitizeTaskReference(delivery.data.task),
          action: delivery.data.action,
          assignee: {
            userId: delivery.data.assignee.userId,
            agentId: delivery.data.assignee.agentId,
          },
          actor: sanitizeActor(delivery.data.actor),
        },
      }
    case 'task.updated':
      return {
        event: delivery.event,
        data: {
          task: sanitizeTaskReference(delivery.data.task),
          changes: sanitizeTaskChanges(delivery.data.changes),
          actor: sanitizeActor(delivery.data.actor),
        },
      }
  }
}

export function createWebhookEnvelope(
  delivery: WebhookDelivery,
  metadata: { id: string; deliveredAt: string }
): WebhookEnvelope {
  // Structurally compatible caller objects may carry extra internal data.
  // Rebuild both the envelope and event payload from public contract fields.
  const sanitized = sanitizeWebhookDelivery(delivery)
  return {
    id: metadata.id,
    event: sanitized.event,
    deliveredAt: metadata.deliveredAt,
    data: sanitized.data,
  } as WebhookEnvelope
}

type EventDefinition = {
  description: string
  dataFields: Record<string, string>
}

const taskReferenceFields = {
  'task.id': 'number — internal task id',
  'task.ticketNumber': 'string|null — board ticket reference, for example HTPR-5168',
  'task.projectId': 'number — board id',
  'task.title': 'string — task title at delivery time',
}

const actorFields = {
  'actor.userId': 'number|null — authenticated human actor',
  'actor.agentId': 'string|null — authenticated agent actor when applicable',
}

// Returned by GET /api/mcp/webhooks so clients can discover the payload
// contract without consulting server source. OpenWiki carries full examples.
export const WEBHOOK_EVENT_DEFINITIONS = {
  'comment.created': {
    description: 'A comment was added to a task.',
    dataFields: {
      ...taskReferenceFields,
      'comment.id': 'number',
      'comment.text': 'string — comment HTML',
      'comment.createdAt': 'string — ISO-8601 timestamp',
      ...actorFields,
    },
  },
  'task.escalated': {
    description: 'A task was escalated for attention.',
    dataFields: {
      ...taskReferenceFields,
      reason: 'string|null — escalation reason when supplied',
      ...actorFields,
    },
  },
  'task.created': {
    description: 'A task was created.',
    dataFields: {
      ...taskReferenceFields,
      'state.section': '{ id:number, title:string }|null',
      'state.status': '"Normal"|"Archive"|"Deleted"',
      'state.priority': '{ id:string, index:number, value:string }|null',
      'state.dueDate': 'string|null — ISO-8601 timestamp',
      'state.startDate': 'string|null — ISO-8601 timestamp',
      ...actorFields,
    },
  },
  'task.assigned': {
    description: 'A human or agent was assigned to or unassigned from a task.',
    dataFields: {
      ...taskReferenceFields,
      action: '"assigned"|"unassigned"',
      'assignee.userId': 'number',
      'assignee.agentId': 'string|null — agent id, or null for a human assignment',
      ...actorFields,
    },
  },
  'task.updated': {
    description:
      'A task section, status, or due date changed. Changes contains at least one field.',
    dataFields: {
      ...taskReferenceFields,
      changes: 'object — contains at least one changed field listed below',
      'changes.section':
        '{ from:{ id:number, title:string }|null, to:{ id:number, title:string }|null } — optional',
      'changes.status':
        '{ from:"Normal"|"Archive"|"Deleted", to:"Normal"|"Archive"|"Deleted" } — optional',
      'changes.dueDate':
        '{ from:string|null, to:string|null } — optional; strings are ISO-8601 timestamps',
      ...actorFields,
    },
  },
} as const satisfies Record<WebhookEventType, EventDefinition>

export function isWebhookEvent(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value)
}

export function parseWebhookEventSelection(value: unknown):
  | { ok: true; events: WebhookEventType[] }
  | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, events: [] }
  if (!Array.isArray(value)) {
    return { ok: false, error: 'events must be an array of event names' }
  }

  const hasInvalid = value.some(
    (event) => typeof event !== 'string' || !isWebhookEvent(event)
  )
  if (hasInvalid) {
    return {
      ok: false,
      error: `Unknown event. Allowed: ${WEBHOOK_EVENTS.join(', ')}`,
    }
  }

  return { ok: true, events: [...new Set(value as WebhookEventType[])] }
}
