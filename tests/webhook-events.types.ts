import type {
  WebhookDelivery,
  WebhookEventPayload,
} from '@/lib/mcp/webhooks/events'

declare const createdPayload: WebhookEventPayload<'task.created'>
declare const assignedPayload: WebhookEventPayload<'task.assigned'>

const validDelivery: WebhookDelivery = {
  event: 'task.created',
  data: createdPayload,
}

// @ts-expect-error An event must stay correlated with its own payload shape.
const mismatchedDelivery: WebhookDelivery = {
  event: 'task.created',
  data: assignedPayload,
}

// @ts-expect-error task.updated must describe at least one changed field.
const emptyChanges: WebhookEventPayload<'task.updated'>['changes'] = {}

void validDelivery
void mismatchedDelivery
void emptyChanges
