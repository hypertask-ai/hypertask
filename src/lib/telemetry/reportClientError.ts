// Fire-and-forget crash beacon. The collector dedupes reports and creates a bug
// ticket for the first occurrence.
let sent = 0

export type ClientErrorPayload = {
  source: string // where it came from: window.onerror, unhandledrejection, RootErrorBoundary, global-error
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
  // TanStack Query throws this when an in-flight query is cancelled (e.g. a
  // refetch superseded by navigation) — expected behavior, not an app bug.
  if (payload.message === 'CancelledError') return
  // React Fizz's inline $RS helper can arrive after navigation or hydration
  // has already discarded its streamed segment markers. React treats the
  // equivalent missing-boundary race as safe to ignore; do not turn this
  // framework cleanup race into an auto-created product bug. Keep the match
  // tied to the exact runtime helper so real parentNode errors still report.
  if (
    payload.source === 'window.onerror' &&
    /^(?:(?:Uncaught TypeError: )?Cannot read properties of null \(reading 'parentNode'\)|(?:TypeError: )?can't access property "parentNode", [A-Za-z_$][\w$]* is null)$/.test(
      payload.message || ''
    ) &&
    /(?:\bat \$RS \(https:\/\/app\.hypertask\.ai\/|(?:^|\n)\$RS@https:\/\/app\.hypertask\.ai\/)/.test(
      payload.stack || ''
    )
  ) return
  // Chromium can reject a cancelled fetch with this exact AbortError when a
  // task-detail effect is torn down during navigation. It is an expected
  // request cancellation, not a crash (HTPR-5018). Keep the stack/name check
  // narrow so unrelated errors with similar prose are still reported.
  if (
    payload.source === 'unhandledrejection' &&
    payload.message === 'signal is aborted without reason' &&
    /^AbortError\b/.test(payload.stack || '')
  ) return
  // The Android shell reports a dropped/offline native fetch as this bare
  // TypeError. With no HTTP response, it is transport noise equivalent to the
  // Axios "Network Error" below, not a server-side bug (HTPR-5078).
  if (
    payload.source === 'unhandledrejection' &&
    payload.message === 'Failed to fetch' &&
    /^TypeError\b/.test(payload.stack || '') &&
    /\bHypertaskApp\b/.test(navigator.userAgent)
  ) return
  // Android WebView uses this lowercase form when the native transport drops.
  // The root boundary already reloads the page, so only suppress its bug report.
  if (
    payload.source === 'global-error' &&
    payload.message === 'network error' &&
    /^TypeError: network error(?:\n|$)/.test(payload.stack || '') &&
    /\bHypertaskApp\b/.test(navigator.userAgent)
  ) return
  // Bare axios network failure (offline, dropped connection, aborted on
  // navigation) — no status code, nothing the app can act on.
  if (payload.message === 'Network Error') return
  // Expired session: nookies_user outlives ht_session, so the app renders as
  // logged in and every call 401s. axiosClient already recovers by clearing the
  // cookie and sending the user to /login (HTPR-4182), so the rejection is
  // expected auth recovery, not an app bug. Other status codes still report.
  if (/\bRequest failed with status code 401\b/.test(payload.message || '')) return
  // Headless Chrome root-crashes this app with React #310 in ways real browsers
  // never do (HTPR-4085), and our own automated QA is what runs headless. Those
  // reports cost real triage time without describing a user-visible fault.
  if (navigator.webdriver === true || /HeadlessChrome/i.test(navigator.userAgent)) return
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
      // sendBeacon survives the tab crashing/navigating away.
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
    // Telemetry must never break the app.
  }
}
