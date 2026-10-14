import { AsyncLocalStorage } from 'node:async_hooks'
import { Client, Pool } from 'pg'
import type { ClientBase, PoolClient, PoolConfig } from 'pg'

export type McpDbTiming = {
  queries: number
  queryMs: number
  maxMs: number
  maxOperation?: string
  connections: number
  connectMs: number
  waitMs: number
}

export const mcpDbTimings = new AsyncLocalStorage<McpDbTiming>()

export function createMcpDbTiming(): McpDbTiming {
  return { queries: 0, queryMs: 0, maxMs: 0, connections: 0, connectMs: 0, waitMs: 0 }
}

export function mcpDbTimingHeader(timing: McpDbTiming): string {
  return `db_q;dur=${timing.queryMs.toFixed(1)};desc="${timing.queries}", ` +
    `db_max;dur=${timing.maxMs.toFixed(1)}` + (timing.maxOperation ? `;desc="${timing.maxOperation}"` : '') +
    `, db_conn;dur=${timing.connectMs.toFixed(1)};desc="${timing.connections}", db_wait;dur=${timing.waitMs.toFixed(1)}`
}

type AcquireCallback = (err: Error | undefined, client: PoolClient | undefined, release: (err?: Error | boolean) => void) => void
type ConnectCallback = ((err: Error) => void) | ((err: null, client: ClientBase) => void)

export function createMcpTimingPool(config: PoolConfig): Pool {
  let measuredAcquisitions = 0
  const connections = new WeakMap<ClientBase, number>()

  class TimingClient extends Client {
    private queryTail = Promise.resolve()

    query: Client['query'] = (...args: any[]): any => {
      const run = () => super.query.apply(this, args as Parameters<Client['query']>)
      if (args.some(arg => typeof arg === 'function') || typeof args[0]?.submit === 'function') return run()
      const result = this.queryTail.then(run)
      this.queryTail = result.then(() => undefined, () => undefined)
      return result
    }

    connect(): Promise<Client>
    connect(callback: ConnectCallback): void
    connect(callback?: ConnectCallback): Promise<Client> | void {
      if (!measuredAcquisitions) return callback ? super.connect(callback) : super.connect()
      const started = performance.now()
      const done = (err: Error | null) => {
        if (!err) connections.set(this, performance.now() - started)
        if (callback) (callback as (err: Error | null, client: ClientBase) => void)(err, this)
      }
      if (callback) return super.connect(done)
      return super.connect().then(client => { done(null); return client })
    }
  }

  class TimingPool extends Pool {
    connect(): Promise<PoolClient>
    connect(callback: AcquireCallback): void
    connect(callback?: AcquireCallback): Promise<PoolClient> | void {
      const store = mcpDbTimings.getStore()
      if (!store) return callback ? super.connect(callback) : super.connect()
      const started = performance.now()
      measuredAcquisitions++
      const acquire = (done: AcquireCallback) => super.connect((err, client, release) => {
        measuredAcquisitions--
        const connectMs = client ? connections.get(client) : undefined
        if (client) connections.delete(client)
        if (connectMs !== undefined) {
          store.connections++
          store.connectMs += connectMs
        }
        if (!err) store.waitMs += Math.max(0, performance.now() - started - (connectMs ?? 0))
        done(err, client, release)
      })
      if (callback) return acquire(callback)
      return new Promise<PoolClient>((resolve, reject) => acquire((err, client) => {
        if (err) reject(err)
        else resolve(client!)
      }))
    }
  }

  const pool = new TimingPool({ ...config, Client: TimingClient })
  pool.on('release', (_err, client) => { connections.delete(client) })
  return pool
}
