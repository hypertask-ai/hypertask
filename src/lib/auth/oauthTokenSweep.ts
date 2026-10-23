import type { Prisma, PrismaClient } from '@prisma/client'
import { classifyOAuthToken, decodeOAuthToken, encodeOAuthToken, OAUTH_TOKEN_FIELDS, OAUTH_TOKEN_PREFIX, preflightOAuthTokenKey } from './oauthTokenCipher'

type TokenDatabase = Pick<PrismaClient, 'betterAuthAccount'>
const select = { id: true, updatedAt: true, accessToken: true, refreshToken: true, idToken: true } as const
const pending: Prisma.BetterAuthAccountWhereInput = {
  OR: OAUTH_TOKEN_FIELDS.map(field => ({
    AND: [{ [field]: { not: null } }, { [field]: { not: '' } }, { NOT: { [field]: { startsWith: OAUTH_TOKEN_PREFIX } } }],
  })),
}

export async function sweepOAuthTokens(db: TokenDatabase, mode: 'dry-run' | 'apply' = 'apply', deadline = Date.now() + 20_000) {
  preflightOAuthTokenKey()
  const counts = { scanned: 0, encrypted: 0, conflicts: 0, invalid: 0, remaining: 0 }
  try {
    const rows = await db.betterAuthAccount.findMany({ where: pending, select, orderBy: { id: 'asc' }, take: 100 })
    for (const row of rows) {
      counts.scanned++
      for (const field of OAUTH_TOKEN_FIELDS) {
        if (classifyOAuthToken(field, row[field]) === 'invalid') {
          counts.invalid++
          counts.remaining = await db.betterAuthAccount.count({ where: pending })
          return counts
        }
      }
    }
    for (const row of rows) {
      if (Date.now() >= deadline) break
      const data: Partial<Record<typeof OAUTH_TOKEN_FIELDS[number], string>> = {}
      for (const field of OAUTH_TOKEN_FIELDS) {
        const raw = row[field]
        if (raw && classifyOAuthToken(field, raw) === 'plaintext') {
          const encrypted = encodeOAuthToken(field, raw)
          if (decodeOAuthToken(field, encrypted) !== raw) throw new Error()
          data[field] = encrypted
        }
      }
      if (Object.keys(data).length === 0 || mode === 'dry-run') continue
      const result = await db.betterAuthAccount.updateMany({
        where: {
          id: row.id,
          updatedAt: row.updatedAt,
          accessToken: row.accessToken,
          refreshToken: row.refreshToken,
          idToken: row.idToken,
        },
        data,
      })
      if (result.count === 0) counts.conflicts++
      else counts.encrypted++
    }
    counts.remaining = await db.betterAuthAccount.count({ where: pending })
    return counts
  } catch {
    throw new Error('oauth_token_sweep_failed')
  }
}

export async function verifyOAuthTokens(db: TokenDatabase, deadline = Date.now() + 20_000) {
  preflightOAuthTokenKey()
  const counts = { total: 0, encrypted: 0, plaintextLeft: 0, failures: 0 }
  try {
    const last = await db.betterAuthAccount.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
    if (!last) return counts
    let cursor = 0
    for (let page = 0; page < 10_000 && Date.now() < deadline; page++) {
      const rows = await db.betterAuthAccount.findMany({
        where: { id: { gt: cursor, lte: last.id } }, select, orderBy: { id: 'asc' }, take: 100,
      })
      if (rows.length === 0) return counts
      for (const row of rows) {
        for (const field of OAUTH_TOKEN_FIELDS) {
          const state = classifyOAuthToken(field, row[field])
          if (state === 'empty') continue
          counts.total++
          if (state === 'encrypted') counts.encrypted++
          else if (state === 'plaintext') counts.plaintextLeft++
          else counts.failures++
        }
        cursor = row.id
      }
      if (cursor >= last.id) return counts
    }
  } catch {
    throw new Error('oauth_token_verification_failed')
  }
  throw new Error('oauth_token_verification_incomplete')
}
