import { publishJob } from "@/lib/qstash";

export const AGENT_WEBHOOK_QUEUE_PATH = "/api/queues/agentWebhookDelivery";

export function queueAgentWebhookDelivery(
  deliveryId: string,
  notBefore?: number,
) {
  return publishJob({
    path: AGENT_WEBHOOK_QUEUE_PATH,
    body: { deliveryId },
    ...(notBefore ? { notBefore } : {}),
  });
}
