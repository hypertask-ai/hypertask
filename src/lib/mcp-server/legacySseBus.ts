type Listener = (message: string) => void

type RelayClient = {
  connect: () => Promise<unknown>
  subscribe: (channel: string) => Promise<unknown>
  unsubscribe: (channel: string) => Promise<unknown>
  publish: (channel: string, message: string) => Promise<number>
  on: (event: string, listener: (...args: string[]) => void) => void
  disconnect: () => void
}

type Relay = {
  client: RelayClient
  counts: Map<string, number>
  tails: Map<string, Promise<void>>
}

const globalBus = globalThis as typeof globalThis & {
  __hypertaskLegacySseBus?: Map<string, Set<Listener>>
  __hypertaskLegacySseRelay?: Promise<Relay | null>
  __hypertaskLegacySsePublisher?: Promise<RelayClient | null>
}

function listeners(): Map<string, Set<Listener>> {
  return globalBus.__hypertaskLegacySseBus ??= new Map()
}

function deliverLocal(channel: string, message: string): number {
  const subscribed = listeners().get(channel)
  if (!subscribed?.size) return 0
  for (const listener of subscribed) listener(message)
  return subscribed.size
}

export function publishLegacySse(channel: string, message: string): number {
  return deliverLocal(channel, message)
}

export function subscribeLegacySse(channel: string, listener: Listener): () => void {
  const subscribed = listeners().get(channel) ?? new Set()
  subscribed.add(listener)
  listeners().set(channel, subscribed)
  return () => {
    subscribed.delete(listener)
    if (subscribed.size === 0) listeners().delete(channel)
  }
}

function relayUrl(): string | null {
  const url = process.env.REDIS_URL?.trim() || process.env.KV_URL?.trim()
  return url || null
}

async function openClient(url: string, onMessage?: (channel: string, message: string) => void): Promise<RelayClient | null> {
  let client: RelayClient | undefined
  try {
    const { default: Redis } = await import("ioredis")
    client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 250,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    })
    client.on("error", () => {})
    if (onMessage) client.on("message", onMessage)
    let timer: ReturnType<typeof setTimeout> | undefined
    const connected = client.connect().then(() => true, () => false)
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), 400)
    })
    const ready = await Promise.race([connected, timedOut])
    clearTimeout(timer)
    if (!ready) {
      client.disconnect()
      return null
    }
    return client
  } catch {
    client?.disconnect()
    return null
  }
}

async function relay(): Promise<Relay | null> {
  const url = relayUrl()
  if (!url) return null
  const pending = globalBus.__hypertaskLegacySseRelay ??= openClient(url, deliverLocal).then((client) => {
    if (!client) {
      if (globalBus.__hypertaskLegacySseRelay === pending) globalBus.__hypertaskLegacySseRelay = undefined
      return null
    }
    return { client, counts: new Map(), tails: new Map() }
  })
  return pending
}

async function commandClient(): Promise<RelayClient | null> {
  const url = relayUrl()
  if (!url) return null
  const pending = globalBus.__hypertaskLegacySsePublisher ??= openClient(url).then((client) => {
    if (!client && globalBus.__hypertaskLegacySsePublisher === pending) globalBus.__hypertaskLegacySsePublisher = undefined
    return client
  })
  return pending
}

async function subscribeRemote(channel: string): Promise<() => void> {
  const current = await relay()
  if (!current) return () => {}
  const previous = current.tails.get(channel) ?? Promise.resolve()
  let release = async () => {}
  const next = previous.then(async () => {
    const count = current.counts.get(channel) ?? 0
    if (count === 0) await current.client.subscribe(channel)
    current.counts.set(channel, count + 1)
    release = () => {
      const done = (current.tails.get(channel) ?? Promise.resolve()).then(async () => {
        const left = (current.counts.get(channel) ?? 1) - 1
        if (left <= 0) {
          current.counts.delete(channel)
          await current.client.unsubscribe(channel)
        } else {
          current.counts.set(channel, left)
        }
      })
      current.tails.set(channel, done.then(() => undefined, () => undefined))
      return done
    }
  }).catch(() => {
    release = async () => {}
  })
  current.tails.set(channel, next.then(() => undefined, () => undefined))
  await next
  return () => release()
}

export async function subscribeLegacySseAcrossProcesses(channel: string, listener: Listener): Promise<() => void> {
  const unsubscribeLocal = subscribeLegacySse(channel, listener)
  const unsubscribeRemote = await subscribeRemote(channel)
  return () => {
    unsubscribeLocal()
    void unsubscribeRemote()
  }
}

export async function publishLegacySseAcrossProcesses(channel: string, message: string): Promise<number> {
  const local = deliverLocal(channel, message)
  if (local > 0) return local
  try {
    const client = await commandClient()
    if (!client) return 0
    return await client.publish(channel, message)
  } catch {
    return 0
  }
}
