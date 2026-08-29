// Run: node --experimental-test-module-mocks --import tsx --test src/lib/mcp/idempotency/__tests__/idempotencyStore.test.ts
import assert from 'node:assert/strict'
import test, { before, beforeEach, mock } from 'node:test'

type IdempotencyStoreModule = typeof import('../idempotencyStore')

const store = new Map<string, string>()

const fakeRedis = {
  async get(key: string): Promise<string | null> {
    return store.get(key) ?? null
  },

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<'OK' | null> {
    const nx = args.includes('NX')
    if (nx && store.has(key)) {
      return null
    }
    store.set(key, value)
    return 'OK'
  },

  async del(key: string): Promise<number> {
    return store.delete(key) ? 1 : 0
  }
}

mock.module('@/lib/redis', {
  namedExports: {
    getRedis: async () => fakeRedis
  }
})

let createIdempotencyRedisKey: IdempotencyStoreModule['createIdempotencyRedisKey']
let IdempotencyInProgressError: IdempotencyStoreModule['IdempotencyInProgressError']
let withIdempotency: IdempotencyStoreModule['withIdempotency']

before(async () => {
  const idempotencyStore = await import('../idempotencyStore')
  createIdempotencyRedisKey = idempotencyStore.createIdempotencyRedisKey
  IdempotencyInProgressError = idempotencyStore.IdempotencyInProgressError
  withIdempotency = idempotencyStore.withIdempotency
})

beforeEach(() => {
  store.clear()
})

test('replays the stored result for the same key without rerunning the producer', async () => {
  let counter = 0
  const producer = async () => ({ value: ++counter })
  const args = ['create_board', 42, 'same-key', { title: 'Roadmap' }] as const

  const first = await withIdempotency(...args, producer)
  const second = await withIdempotency(...args, producer)

  assert.equal(counter, 1)
  assert.deepEqual(first, { value: 1 })
  assert.deepEqual(second, { value: 1, idempotent_replayed: true })
})

test('rejects when a same-key request remains in progress', async () => {
  const operation = 'create_board'
  const userId = 42
  const clientKey = 'in-progress-key'
  const requestBody = { title: 'Roadmap' }
  const redisKey = createIdempotencyRedisKey(
    operation,
    userId,
    clientKey,
    requestBody
  )
  store.set(redisKey, '\0__mcp_idempotency_pending__')

  await assert.rejects(
    withIdempotency(
      operation,
      userId,
      clientKey,
      requestBody,
      async () => ({ value: 'unexpected' })
    ),
    IdempotencyInProgressError
  )
})

test('runs the producer again for a different client key', async () => {
  let counter = 0
  const producer = async () => ({ value: ++counter })

  const first = await withIdempotency(
    'create_board',
    42,
    'first-key',
    { title: 'Roadmap' },
    producer
  )
  const second = await withIdempotency(
    'create_board',
    42,
    'second-key',
    { title: 'Roadmap' },
    producer
  )

  assert.equal(counter, 2)
  assert.deepEqual(first, { value: 1 })
  assert.deepEqual(second, { value: 2 })
})
