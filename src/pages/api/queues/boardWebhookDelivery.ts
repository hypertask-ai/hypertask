import type { NextApiRequest, NextApiResponse } from "next";
import { withQstashSignature } from "@/lib/qstash";
import { deliverBoardWebhook } from "@/lib/mcp/webhooks/outboxDelivery";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const deliveryId =
    req.body && typeof req.body.deliveryId === "string"
      ? req.body.deliveryId.trim()
      : "";
  if (!deliveryId) {
    return res.status(400).json({ ok: false, error: "deliveryId is required" });
  }

  try {
    const result = await deliverBoardWebhook(deliveryId);
    // Retry scheduling is explicit and durable, so QStash should not also retry
    // this internal message and create overlapping attempts.
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    console.error("[board-webhook] delivery queue failed", error);
    return res.status(500).json({ ok: false });
  }
}

export default withQstashSignature(handler);

export const config = { api: { bodyParser: false } };
