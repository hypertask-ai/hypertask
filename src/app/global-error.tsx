'use client' // global-error must be a Client Component and render its own <html>/<body>

import { useEffect } from 'react'
import { isChunkLoadError } from '@/utils/helperFunctions/isChunkLoadError'
import { reportClientError } from '@/lib/telemetry/reportClientError'
import {
  buildChunkRecoveryUrl,
  canReachPage,
  CHUNK_RELOAD_STORAGE_KEY,
  nextChunkRecoveryAttempt,
} from '@/utils/helperFunctions/chunkLoadRecovery'

// Catches crashes in the ROOT layout / Providers chain. error.tsx cannot reach
// those, so without this a root-level crash (provider throw, hydration mismatch,
// or a stale JS chunk after a deploy) renders a blank white page that only a
// manual refresh clears. PERT-89.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string; componentStack?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global error (root crash):', error, { digest: error?.digest })

    const report = () =>
      reportClientError({
        source: 'global-error',
        message: error?.message,
        stack: error?.stack,
        componentStack: error?.componentStack,
        digest: error?.digest,
      })

    if (typeof window === 'undefined') return

    // Stale-bundle crashes are the common "reload once or twice fixes it" case:
    // fetch a cache-busted document instead of replaying cached HTML that points
    // at the same missing chunk. Only report if recovery is unavailable or the
    // capped attempts are exhausted, so successful self-healing does not create
    // an automated bug ticket. HTPR-5253.
    if (isChunkLoadError(error)) {
      const attempt = nextChunkRecoveryAttempt(
        window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)
      )
      if (attempt !== null) {
        let cancelled = false
        const recoveryUrl = buildChunkRecoveryUrl(window.location.href, attempt)

        void canReachPage(recoveryUrl).then((reachable) => {
          if (cancelled) return
          if (!reachable) {
            report()
            return
          }

          window.sessionStorage.setItem(
            CHUNK_RELOAD_STORAGE_KEY,
            String(attempt)
          )
          window.location.replace(recoveryUrl)
        })

        return () => {
          cancelled = true
        }
      }

      report()
      return
    }

    report()

    // Next 14's app-router calls `use(state)` only when the router state is a
    // pending promise (useUnwrapState). If an RSC request is still in flight
    // while the page hydrates, that conditional hook changes the hook count and
    // React throws #310 ("Rendered more hooks than during the previous render")
    // from inside AppRouter itself. It is a hydration race, so re-hydrating
    // almost always succeeds. Public /share links hit it hardest (HTPR-4089).
    // Capped per tab session so a deterministic crash still surfaces the UI.
    const KEY = 'ht-root-reload'
    const tries = Number(window.sessionStorage.getItem(KEY) || '0')
    if (tries < 2) {
      window.sessionStorage.setItem(KEY, String(tries + 1))
      window.location.reload()
    }
  }, [error])

  return (
    <html>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          fontFamily:
            'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          background: '#f5f5f5',
          color: '#1a1a1a',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: '2rem',
            textAlign: 'center',
            boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚠️</div>
          <h1 style={{ fontSize: '1.4rem', margin: '0 0 0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ margin: '0 0 1.5rem', color: '#666', fontSize: '0.95rem' }}>
            We hit a snag loading the page. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '1rem',
              fontWeight: 600,
              color: '#fff',
              background: '#5b3df5',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
