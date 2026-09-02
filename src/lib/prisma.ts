
// import { PrismaClient } from "@prisma/client";

// const prisma = new PrismaClient();
// export default prisma

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { isApiKeyAuthLookup, withApiKeyExpiryGuard } from '@/lib/apiKeyExpiry'
import { trackPrismaQuery } from '@/lib/queryCountTracker'

// HTPR-4119: Prisma 7 requires a driver adapter, the query engine no longer
// connects from a schema-declared url. Build the adapter inside the singleton
// factory so a hot reload reuses the cached client's pool instead of orphaning
// a new pg pool on every module re-evaluation.
// Operations that accept `relationLoadStrategy` in Prisma 7 (verified against
// @prisma/client 7.9): the reads plus the single-row writes that read relations
// back via `include`/`select`. `createManyAndReturn`/`updateManyAndReturn` are
// deliberately excluded — they REJECT `relationLoadStrategy` (and can still carry
// a `select`), so setting it there would throw. Batch writes and
// count/aggregate/groupBy never carry include/select, so the guard skips them.
const RELATION_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "create",
  "update",
  "upsert",
  "delete",
])

const prismaClientSingleton = () => {
  // HTPR-5954: node-postgres's default idleTimeoutMillis (10s) closes the
  // client's TCP/TLS connection to the Neon pooler between requests on a
  // low-traffic instance, forcing a fresh handshake on the next query.
  // Confirmed the pooler itself keeps backend Postgres connections warm
  // regardless (pg_stat_activity showed idle backends minutes old surviving
  // fresh client reconnects) -- the repeated cost is client-to-pooler TLS/auth
  // only. Keeping the client-side connection open longer removes that
  // re-handshake on the common case where the next request lands within 5min.
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL as string,
    idleTimeoutMillis: 5 * 60_000,
    keepAlive: true,
  })
  const client = new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        // The `relationJoins` preview feature flips the GLOBAL default relation
        // load strategy to `join` for every relation-loading read AND write. We
        // only want `join` on the few hot queries that opt in explicitly (e.g.
        // the inbox in notifications/getAll), so default every other relation
        // load back to `query`. This keeps app-wide behaviour byte-identical to
        // before the flag; a caller overrides with `relationLoadStrategy: "join"`
        // where a single JOIN beats N per-relation round-trips.
        async $allOperations({ model, operation, args, query }) {
          trackPrismaQuery(model)
          // HTPR-4501: an expired API key must never resolve to an account.
          // Enforcing it here rather than at one call site means every present
          // and future lookup-by-secret inherits the check; management screens
          // list keys by userId and still see expired ones.
          if (isApiKeyAuthLookup(model, operation, args)) {
            ;(args as any).where = withApiKeyExpiryGuard((args as any).where)
          }
          if (
            RELATION_OPS.has(operation) &&
            args &&
            typeof args === "object" &&
            ((args as any).include || (args as any).select) &&
            (args as any).relationLoadStrategy === undefined
          ) {
            ;(args as any).relationLoadStrategy = "query"
          }
          return query(args)
        },
      },
    },
  })
  // The query-only extension changes runtime behaviour, not the surface API, so
  // present it to the app as a plain PrismaClient. This keeps every existing
  // `Pick<PrismaClient, ...>` / `Prisma.TransactionClient` call site type-checking
  // (nothing uses $on/$use/$extends on the default export) and avoids a deep
  // generic instantiation on the inbox include.
  return client as unknown as PrismaClient
}

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma

export default prisma