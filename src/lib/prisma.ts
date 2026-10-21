


import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { isApiKeyAuthLookup, withApiKeyExpiryGuard } from '@/lib/apiKeyExpiry'
import { trackPrismaQuery } from '@/lib/queryCountTracker'
import { createMcpTimingPool, mcpDbTimings } from '@/lib/mcp/dbTiming'
import { normalizeDbConnectionString } from '@/lib/dbConnectionString'

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
  const adapter = new PrismaPg(createMcpTimingPool({
    connectionString: normalizeDbConnectionString(process.env.DATABASE_URL),
    idleTimeoutMillis: 5 * 60_000,
    keepAlive: true,
  }), { disposeExternalPool: true })
  const client = new PrismaClient({ adapter }).$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (model) trackPrismaQuery(model)
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
        const store = mcpDbTimings.getStore()
        if (!store) return query(args)
        const started = performance.now()
        store.queries++
        try {
          return await query(args)
        } finally {
          const ms = performance.now() - started
          store.queryMs += ms
          if (!store.maxOperation || ms > store.maxMs) {
            store.maxMs = ms
            store.maxOperation = `${model ?? 'Prisma'}.${operation}`
          }
        }
      },
    },
  })
  return client as unknown as PrismaClient
}

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma

export default prisma