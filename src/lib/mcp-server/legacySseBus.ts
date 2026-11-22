type Listener = (message: string) => void

const globalBus = globalThis as typeof globalThis & {
  __hypertaskLegacySseBus?: Map<string, Set<Listener>>
}

function listeners(): Map<string, Set<Listener>> {
  return globalBus.__hypertaskLegacySseBus ??= new Map()
}

export function publishLegacySse(channel: string, message: string): number {
  const subscribed = listeners().get(channel)
  if (!subscribed?.size) return 0
  for (const listener of subscribed) listener(message)
  return subscribed.size
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
