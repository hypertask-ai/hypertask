import { createHash } from 'crypto'

import { verifiedSessionExpiry } from '@/lib/auth/session'
import { getRedis } from '@/lib/redis'

const revokedTokens = new Map<string, number>()
const READ_DEADLINE_MS = 300
const WRITE_DEADLINE_MS = 500

function verifiedToken(token: string | undefined) {
  const exp = verifiedSessionExpiry(token)
  if (exp === null || !token) return null

  const fingerprint = createHash('sha256').update(token.split('.')[0]).digest('hex')
  return { fingerprint, exp }
}

export function sessionTokenFingerprint(token: string | undefined): string | null {
  return verifiedToken(token)?.fingerprint ?? null
}

function cacheRevocation(fingerprint: string, exp: number) {
  revokedTokens.delete(fingerprint)
  if (revokedTokens.size >= 1000) {
    revokedTokens.delete(revokedTokens.keys().next().value!)
  }
  revokedTokens.set(fingerprint, exp)
}

async function withDeadline<T>(operation: () => Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Session revocation deadline exceeded')), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function revokeSessionToken(token: string | undefined): Promise<void> {
  const verified = verifiedToken(token)
  if (!verified) return

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await withDeadline(async () => {
        const redis = await getRedis()
        const ttl = Math.ceil(verified.exp - Math.floor(Date.now() / 1000))
        if (ttl <= 0) return
        await redis.set(`ht_session:revoked:${verified.fingerprint}`, '1', 'EX', ttl)
        cacheRevocation(verified.fingerprint, verified.exp)
      }, WRITE_DEADLINE_MS)
      return
    } catch {
      if (attempt === 1) console.error('Session token revocation failed after retry')
    }
  }
}

export async function isSessionTokenRevoked(
  token: string | undefined,
  { failClosed }: { failClosed: boolean },
): Promise<boolean> {
  const verified = verifiedToken(token)
  if (!verified) return false

  const cachedExpiry = revokedTokens.get(verified.fingerprint)
  if (cachedExpiry !== undefined) {
    if (cachedExpiry > Math.floor(Date.now() / 1000)) return true
    revokedTokens.delete(verified.fingerprint)
  }

  try {
    const revoked = await withDeadline(async () => {
      const redis = await getRedis()
      return await redis.get(`ht_session:revoked:${verified.fingerprint}`)
    }, READ_DEADLINE_MS)
    if (revoked !== null) {
      cacheRevocation(verified.fingerprint, verified.exp)
      return true
    }
    return false
  } catch {
    return failClosed
  }
}
