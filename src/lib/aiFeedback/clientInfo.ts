import { createHash } from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import { getRedis } from '@/lib/redis'
import { feedbackClient } from './input'

function clientKey(token: string) {
  return `ai-feedback:client:${createHash('sha256').update(token).digest('hex')}`
}

export function rememberFeedbackClient(token: string, name: unknown, _userId: number): void {
  const client = feedbackClient(name)
  if (!client) return
  try {
    waitUntil((async () => {
      await (await getRedis()).set(clientKey(token), client, 'EX', 3600)
    })().catch(() => {}))
  } catch {}
}

export async function getFeedbackClient(token: string): Promise<string | undefined> {
  try { return feedbackClient(await (await getRedis()).get(clientKey(token))) } catch { return undefined }
}
