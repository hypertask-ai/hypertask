let sent = 0

const CHUNK_LOAD_TIMEOUT_MS = 120_000

export type ClientErrorPayload = {
  source: string
  message?: string
  stack?: string
  componentStack?: string
  digest?: string
  extra?: Record<string, string | number | boolean | null>
}

export function reportClientError(payload: ClientErrorPayload) {
  if (typeof window === 'undefined') return
  const diagnostic = [
    payload.message,
    payload.stack,
    payload.componentStack,
  ].filter(Boolean).join('\n')
  if (payload.message?.trim().toLowerCase() === 'script error.') return
  if (payload.message === 'CancelledError') return
  if (
    payload.source === 'window.onerror' &&
    /^(?:(?:Uncaught TypeError: )?Cannot read properties of null \(reading 'parentNode'\)|(?:TypeError: )?can't access property "parentNode", [A-Za-z_$][\w$]* is null|(?:Uncaught )?(?:TypeError: )?[A-Za-z_$][\w$]* is null)$/.test(
      payload.message || ''
    ) &&
    /(?:\bat \$RS \(https:\/\/app\.hypertask\.ai\/|(?:^|\n)\$RS@https:\/\/app\.hypertask\.ai\/)/.test(
      payload.stack || ''
    )
  ) return
  if (
    payload.source === 'unhandledrejection' &&
    payload.message === 'signal is aborted without reason' &&
    /^AbortError\b/.test(payload.stack || '')
  ) return
  if (
    payload.source === 'unhandledrejection' &&
    payload.message === 'Failed to fetch' &&
    /^TypeError\b/.test(payload.stack || '') &&
    /\bHypertaskApp\b/.test(navigator.userAgent)
  ) return
  if (
    payload.source === 'global-error' &&
    payload.message === 'network error' &&
    /^TypeError: network error(?:\n|$)/.test(payload.stack || '') &&
    /\bHypertaskApp\b/.test(navigator.userAgent)
  ) return
  if (
    (payload.source === 'global-error' || payload.source === 'unhandledrejection') &&
    payload.message === 'network error' &&
    /^(?:(?:Type)?Error: network error)?\s*$/.test(payload.stack || '') &&
    !payload.componentStack?.trim() &&
    !payload.digest
  ) return
  if (payload.message === 'Network Error') return
  if (
    payload.source === 'unhandledrejection' &&
    payload.message === 'Request aborted' &&
    payload.extra?.axiosCode === 'ECONNABORTED'
  ) return
  if (/\bRequest failed with status code 401\b/.test(payload.message || '')) return
  if (navigator.webdriver === true || /HeadlessChrome/i.test(navigator.userAgent)) return
  if (
    /^Loading chunk \S+ failed\.\n\(timeout: /.test(payload.message || '') &&
    typeof performance !== 'undefined' &&
    performance.now() < CHUNK_LOAD_TIMEOUT_MS
  ) return
  if (/(?:chrome|moz|safari|ms-browser)-extension:\/\//i.test(diagnostic)) return
  if (sent >= 3) return
  sent++
  try {
    const stack = [
      payload.stack,
      payload.componentStack
        ? `Component stack:\n${payload.componentStack}`
        : undefined,
    ].filter(Boolean).join('\n\n')
    const extra = Object.fromEntries(
      Object.entries(payload.extra || {})
        .slice(0, 7)
        .map(([key, value]) => [
          key.slice(0, 64),
          typeof value === 'string' ? value.slice(0, 4000) : value,
        ])
    )
    const body = JSON.stringify({
      source: 'client',
      message: payload.message || 'Unknown client error',
      stack: stack || undefined,
      url: window.location.href,
      extra: {
        ...extra,
        origin: payload.source,
        userAgent: navigator.userAgent.slice(0, 200),
        ...(payload.digest ? { digest: payload.digest } : {}),
      },
    })
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/errors',
        new Blob([body], { type: 'application/json' })
      )
    } else {
      void fetch('/api/errors', {
        method: 'POST',
        body,
        keepalive: true,
        headers: { 'content-type': 'application/json' },
      })
    }
  } catch {
  }
}
