'use client'

import { useEffect } from 'react'
import {
  reportClientError,
  type ClientErrorPayload,
} from '@/lib/telemetry/reportClientError'
import { wasShareHydrationErrorReported } from '@/lib/telemetry/shareHydrationDiagnostics'
import { axiosErrorDiagnostics } from '@/lib/telemetry/axiosErrorDiagnostics'
import { isChunkLoadError } from '@/utils/helperFunctions/isChunkLoadError'
import {
  buildChunkRecoveryUrl,
  canReachPage,
  CHUNK_RELOAD_STORAGE_KEY,
  nextChunkRecoveryAttempt,
} from '@/utils/helperFunctions/chunkLoadRecovery'

type ClientRejectionEnvironment = {
  href: string
  currentHref: () => string
  previousAttempt: string | null
  canReach: (url: string) => Promise<boolean>
  claimRecovery: (href: string) => boolean
  releaseRecovery: (href: string) => void
  recover: (url: string, attempt: number) => void
  report: (payload: ClientErrorPayload) => void
}

export function readChunkRecoveryAttempt(
  getStorage: () => Pick<Storage, 'getItem'>
): string | null {
  try {
    return getStorage().getItem(CHUNK_RELOAD_STORAGE_KEY)
  } catch {
    return null
  }
}

export async function handleClientRejection(
  reason: unknown,
  environment: ClientRejectionEnvironment
): Promise<void> {
  const error =
    reason && typeof reason === 'object'
      ? (reason as { message?: string; stack?: string })
      : null
  const payload: ClientErrorPayload = {
    source: 'unhandledrejection',
    message:
      typeof reason === 'string'
        ? reason
        : error?.message || 'Unhandled promise rejection',
    stack: typeof reason === 'string' ? undefined : error?.stack,
    extra: axiosErrorDiagnostics(reason),
  }

  if (isChunkLoadError(reason)) {
    const attempt = nextChunkRecoveryAttempt(environment.previousAttempt)
    if (attempt !== null && environment.claimRecovery(environment.href)) {
      try {
        const recoveryUrl = buildChunkRecoveryUrl(environment.href, attempt)
        if (await environment.canReach(recoveryUrl)) {
          if (environment.currentHref() !== environment.href) {
            environment.releaseRecovery(environment.href)
            return
          }
          environment.recover(recoveryUrl, attempt)
          return
        }
      } catch {
        // Report the original chunk failure instead of creating another rejection.
      }
      environment.releaseRecovery(environment.href)
    } else if (attempt !== null) {
      return
    }
  }

  environment.report(payload)
}

// Catches crashes that ESCAPE React's error boundaries — async throws, event
// handlers, and unhandled promise rejections. Boundaries only catch render-phase
// throws, so this window-level listener is what surfaces the crashes that
// otherwise leave a user on a blank screen with nothing logged.
export default function ClientErrorReporter() {
  useEffect(() => {
    const chunkRecoveriesInFlight = new Set<string>()

    const onError = (e: ErrorEvent) => {
      // instrumentation-client captures public-share hydration failures before
      // React starts, with the pre-hydration DOM mutations attached. Avoid
      // filing the same Error object again without those diagnostics.
      if (wasShareHydrationErrorReported(e.error)) return
      // Benign browser quirk (Chrome/Safari), not an app bug: fires when a
      // ResizeObserver callback doesn't finish within one animation frame.
      // https://bugs.chromium.org/p/chromium/issues/detail?id=809574
      if (e.message === 'ResizeObserver loop completed with undelivered notifications.') {
        return
      }
      reportClientError({
        source: 'window.onerror',
        message: e.message,
        stack:
          e.error?.stack ||
          (e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined),
      })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      void handleClientRejection(e.reason, {
        href: window.location.href,
        currentHref: () => window.location.href,
        previousAttempt: readChunkRecoveryAttempt(() => window.sessionStorage),
        canReach: canReachPage,
        claimRecovery: (href) => {
          if (chunkRecoveriesInFlight.has(href)) return false
          chunkRecoveriesInFlight.add(href)
          return true
        },
        releaseRecovery: (href) => {
          chunkRecoveriesInFlight.delete(href)
        },
        recover: (url, attempt) => {
          window.sessionStorage.setItem(
            CHUNK_RELOAD_STORAGE_KEY,
            String(attempt)
          )
          window.location.replace(url)
        },
        report: reportClientError,
      })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
