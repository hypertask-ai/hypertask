type Listener = (message: string) => void

type RelayClient = {
  connect: () => Promise<unknown>
  subscribe: (channel: string) => Promise<unknown>
  unsubscribe: (channel: string) => Promise<unknown>
  publish: (channel: string, message: string) => Promise<number>
  on: (event: string, listener: (...args: string[]) => void) => void
  quit?: () => Promise<unknown>
  disconnect: () => void
  status?: string
}

type Relay = {
  client: RelayClient
  counts: Map<string, number>
  tails: Map<string, Promise<void>>
}

const globalBus = globalThis as typeof globalThis & {
  __hypertaskLegacySseBus?: Map<string, Set<Listener>>
  __hypertaskLegacySseRelay?: Promise<Relay | null>
  __hypertaskLegacySseRelayLive?: Relay | null
  __hypertaskLegacySsePublisher?: Promise<RelayClient | null>
  __hypertaskLegacySsePublisherLive?: RelayClient | null
  __hypertaskLegacySseRelayDown?: Set<() => void>
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

function listenerCount(): number {
  let count = 0
  for (const subscribed of listeners().values()) count += subscribed.size
  return count
}

function dropClient(client: RelayClient | null | undefined) {
  if (!client) return
  if (typeof client.quit === "function") {
    void client.quit().catch(() => client.disconnect())
    return
  }
  client.disconnect()
}

function relayDowns(): Set<() => void> {
  return globalBus.__hypertaskLegacySseRelayDown ??= new Set()
}

function clientEnded(client: RelayClient): boolean {
  return client.status === "end" || client.status === "close"
}

function forgetRelay(client: RelayClient) {
  const live = globalBus.__hypertaskLegacySseRelayLive
  if (!live || live.client !== client) return
  globalBus.__hypertaskLegacySseRelay = undefined
  globalBus.__hypertaskLegacySseRelayLive = undefined
  const notify = [...relayDowns()]
  relayDowns().clear()
  dropClient(client)
  for (const close of notify) close()
}

function forgetPublisher(client: RelayClient) {
  if (globalBus.__hypertaskLegacySsePublisherLive !== client) return
  globalBus.__hypertaskLegacySsePublisher = undefined
  globalBus.__hypertaskLegacySsePublisherLive = undefined
  dropClient(client)
}

function releaseRelay() {
  if (listenerCount() > 0) return
  const relay = globalBus.__hypertaskLegacySseRelayLive
  const publisher = globalBus.__hypertaskLegacySsePublisherLive
  const relayPromise = globalBus.__hypertaskLegacySseRelay
  const publisherPromise = globalBus.__hypertaskLegacySsePublisher
  globalBus.__hypertaskLegacySseRelay = undefined
  globalBus.__hypertaskLegacySseRelayLive = undefined
  globalBus.__hypertaskLegacySsePublisher = undefined
  globalBus.__hypertaskLegacySsePublisherLive = undefined
  dropClient(relay?.client)
  dropClient(publisher)
  void relayPromise?.then((current) => {
    if (current && current !== relay) dropClient(current.client)
  })
  void publisherPromise?.then((client) => {
    if (client && client !== publisher) dropClient(client)
  })
}

async function openClient(url: string, onMessage?: (channel: string, message: string) => void): Promise<RelayClient | null> {
  let client: RelayClient | undefined
  let established = false
  try {
    const { default: Redis } = await import("ioredis")
    client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 250,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times: number) => {
        if (!established || times > 4) return null
        return 50
      },
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
    established = true
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
    if (!client || globalBus.__hypertaskLegacySseRelay !== pending) {
      dropClient(client)
      if (globalBus.__hypertaskLegacySseRelay === pending) globalBus.__hypertaskLegacySseRelay = undefined
      return null
    }
    const current = { client, counts: new Map(), tails: new Map() }
    client.on("end", () => forgetRelay(client))
    globalBus.__hypertaskLegacySseRelayLive = current
    return current
  })
  return pending
}

async function commandClient(): Promise<RelayClient | null> {
  const url = relayUrl()
  if (!url) return null
  const pending = globalBus.__hypertaskLegacySsePublisher ??= openClient(url).then((client) => {
    if (!client || globalBus.__hypertaskLegacySsePublisher !== pending) {
      dropClient(client)
      if (globalBus.__hypertaskLegacySsePublisher === pending) globalBus.__hypertaskLegacySsePublisher = undefined
      return null
    }
    client.on("end", () => forgetPublisher(client))
    globalBus.__hypertaskLegacySsePublisherLive = client
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
    if (count === 0) {
      try {
        await current.client.subscribe(channel)
      } catch (error) {
        if (clientEnded(current.client)) throw error
        await current.client.subscribe(channel)
      }
    }
    current.counts.set(channel, count + 1)
    release = () => {
      let settled: Promise<void> | undefined
      const done = (current.tails.get(channel) ?? Promise.resolve()).then(async () => {
        let finished = false
        try {
          const left = (current.counts.get(channel) ?? 1) - 1
          if (left <= 0) {
            current.counts.delete(channel)
            finished = true
            await current.client.unsubscribe(channel)
          } else {
            current.counts.set(channel, left)
          }
        } finally {
          if (finished && settled && current.tails.get(channel) === settled) current.tails.delete(channel)
        }
      })
      settled = done.then(() => undefined, () => undefined)
      current.tails.set(channel, settled)
      return done
    }
  }).catch((error: unknown) => {
    release = async () => {}
    if (clientEnded(current.client)) forgetRelay(current.client)
    throw error
  })
  current.tails.set(channel, next.then(() => undefined, () => undefined))
  await next
  return () => {
    void Promise.resolve(release()).catch(() => {})
  }
}

export async function subscribeLegacySseAcrossProcesses(
  channel: string,
  listener: Listener,
  onRelayDown?: () => void,
): Promise<() => void> {
  const unsubscribeLocal = subscribeLegacySse(channel, listener)
  if (onRelayDown) relayDowns().add(onRelayDown)
  let unsubscribeRemote: () => void
  try {
    unsubscribeRemote = await subscribeRemote(channel)
  } catch (error) {
    if (onRelayDown) relayDowns().delete(onRelayDown)
    unsubscribeLocal()
    throw error
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    if (onRelayDown) relayDowns().delete(onRelayDown)
    unsubscribeLocal()
    void unsubscribeRemote()
    releaseRelay()
  }
}

export async function publishLegacySseAcrossProcesses(channel: string, message: string): Promise<number> {
  const local = deliverLocal(channel, message)
  if (local > 0) return local
  let client: RelayClient | null = null
  try {
    client = await commandClient()
    if (!client) return 0
    return await client.publish(channel, message)
  } catch {
    if (client && clientEnded(client)) forgetPublisher(client)
    return 0
  }
}
