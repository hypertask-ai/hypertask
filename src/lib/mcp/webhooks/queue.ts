import { publishJob } from '@/lib/qstash'

export const BOARD_WEBHOOK_QUEUE_PATH = '/api/queues/boardWebhookDelivery'

export function queueBoardWebhookDelivery(
  deliveryId: string,
  notBefore?: number
) {
  return publishJob({
    path: BOARD_WEBHOOK_QUEUE_PATH,
    body: { deliveryId },
    ...(notBefore ? { notBefore } : {}),
  })
}
