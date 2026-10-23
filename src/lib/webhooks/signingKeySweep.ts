import type { PrismaClient } from '@prisma/client'
import { SEALED_WEBHOOK_KEYS_FLAG } from '@/lib/flags/definitions/htpr-7624-sealed-webhook-keys'
import { openWebhookSigningKey, sealWebhookSigningKey } from './signingKeyStore'

const pending = { NOT: { secret: { startsWith: 'enc:' } } }
const select = { id: true, secret: true } as const

type SigningKeyModel = {
  findMany(input: { where: typeof pending; select: typeof select; orderBy: { id: 'asc' }; take: number }): Promise<Array<{ id: string; secret: string }>>
  updateMany(input: { where: { id: string; secret: string }; data: { secret: string } }): Promise<{ count: number }>
  count(input: { where: typeof pending }): Promise<number>
}
type SigningKeyDatabase = Pick<PrismaClient, 'featureFlag'> & {
  webhookSubscription: SigningKeyModel
  agentWebhookSubscription: SigningKeyModel
}

export async function sweepWebhookSigningKeys(db: SigningKeyDatabase, deadline = Date.now() + 20_000) {
  const counts = { scanned: 0, encrypted: 0, conflicts: 0, remaining: 0 }
  try {
    const flag = await db.featureFlag.findUnique({
      where: { key: SEALED_WEBHOOK_KEYS_FLAG },
      select: { mode: true },
    })
    if (flag?.mode !== 'EVERYONE') return counts

    for (const model of [db.webhookSubscription, db.agentWebhookSubscription]) {
      const rows = await model.findMany({ where: pending, select, orderBy: { id: 'asc' }, take: 100 })
      for (const row of rows) {
        if (Date.now() >= deadline) break
        counts.scanned++
        const secret = sealWebhookSigningKey(row.secret)
        if (openWebhookSigningKey(secret) !== row.secret) throw new Error()
        const result = await model.updateMany({
          where: { id: row.id, secret: row.secret },
          data: { secret },
        })
        if (result.count === 0) counts.conflicts++
        else counts.encrypted++
      }
      counts.remaining += await model.count({ where: pending })
    }
    return counts
  } catch {
    throw new Error('webhook_signing_key_sweep_failed')
  }
}
