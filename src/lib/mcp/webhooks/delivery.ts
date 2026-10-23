import crypto from 'crypto'
import { Agent, request as undiciRequest } from 'undici'
import prisma from '@/lib/prisma'
import { openWebhookSigningKey } from '@/lib/webhooks/signingKeyStore'
import { signWebhookBody } from './sign'
import { resolveSafeAddresses } from './ssrfGuard'
import type { WebhookDelivery } from './events'
import { createWebhookEnvelope } from './events'

export { signWebhookBody }

const DELIVERY_TIMEOUT_MS = 5000

export type SignedWebhookResult = {
  ok: boolean
  statusCode: number | null
  error: string | null
  durationMs: number
}

export async function postSignedWebhook(input: {
  url: string
  secret: string
  event: string
  deliveryId: string
  body: string
}): Promise<SignedWebhookResult> {
  const startedAt = Date.now()
  let secret: string
  try {
    secret = openWebhookSigningKey(input.secret)
  } catch {
    return {
      ok: false,
      statusCode: null,
      error: 'Webhook signing key is unavailable',
      durationMs: Date.now() - startedAt,
    }
  }
  const safe = await resolveSafeAddresses(input.url)
  if (!safe.ok) {
    return {
      ok: false,
      statusCode: null,
      error: safe.reason,
      durationMs: Date.now() - startedAt,
    }
  }
  const pinned = safe.addresses[0]
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = signWebhookBody(secret, `${timestamp}.${input.body}`)

  const agent = new Agent({
    connect: {
      lookup: (_hostname, options, cb) => {
        if (options && (options as { all?: boolean }).all) {
          cb(null, [{ address: pinned.address, family: pinned.family }] as never)
        } else {
          ;(cb as (e: unknown, a: string, f: number) => void)(null, pinned.address, pinned.family)
        }
      },
    },
  })

  try {
    const res = await undiciRequest(input.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hypertask-event': input.event,
        'x-hypertask-timestamp': timestamp,
        'x-hypertask-delivery': input.deliveryId,
        'x-hypertask-signature': signature,
      },
      body: input.body,
      dispatcher: agent,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })
    const statusCode = res.statusCode
    await res.body.dump()
    return {
      ok: statusCode >= 200 && statusCode < 300,
      statusCode,
      error: statusCode >= 200 && statusCode < 300 ? null : `Receiver returned HTTP ${statusCode}`,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook request failed'
    return {
      ok: false,
      statusCode: null,
      error: message.slice(0, 1000),
      durationMs: Date.now() - startedAt,
    }
  } finally {
    await agent.close().catch(() => {})
  }
}

async function recordOutcome(id: string, ok: boolean): Promise<void> {
  try {
    await prisma.webhookSubscription.update({
      where: { id },
      data: { lastDeliveryAt: new Date(), lastDeliveryOk: ok },
    })
  } catch {
  }
}

export async function deliverWebhook(
  sub: { id: string; url: string; secret: string },
  delivery: WebhookDelivery
): Promise<boolean> {
  const deliveryId = crypto.randomUUID()
  const envelope = createWebhookEnvelope(delivery, {
    id: deliveryId,
    deliveredAt: new Date().toISOString(),
  })
  const body = JSON.stringify(envelope)
  const result = await postSignedWebhook({
    url: sub.url,
    secret: sub.secret,
    event: delivery.event,
    deliveryId,
    body,
  })
  await recordOutcome(sub.id, result.ok)
  return result.ok
}
