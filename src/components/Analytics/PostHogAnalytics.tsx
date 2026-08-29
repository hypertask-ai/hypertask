"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { PostHogInterface } from "posthog-js/dist/module.slim";

import { getCookieConsent } from "@/lib/cookieConsent";
import {
  installProductPerformanceSink,
  isProductReadinessEvent,
  PRODUCT_PERFORMANCE_READY_EVENT,
} from "@/lib/analytics/productPerformance";
import {
  performanceDeviceClass,
  scopeProjectWebVitalsEvent,
} from "@/lib/analytics/appPerformanceScope";
import {
  buildAuthenticatedProjectWebVital,
  metricBelongsToIdentityWindow,
  shouldInstallAuthenticatedProjectWebVitals,
  type AppWebVitalMetric,
} from "@/lib/analytics/appWebVitals";

const AUTHENTICATED_ANALYTICS_PAINT_SETTLE_MS = 2_500;
const AUTHENTICATED_ANALYTICS_MAX_WAIT_MS = 8_000;
const ANONYMOUS_ANALYTICS_FALLBACK_MS = 1_000;

type AnalyticsIdentity = {
  userId: number | null;
  isGuest: boolean;
};

type AnalyticsScheduleController = {
  setAuthenticated: (authenticated: boolean) => void;
};

type WebVitalsInstallState = "idle" | "installing" | "installed";

const identityKey = ({ userId, isGuest }: AnalyticsIdentity) =>
  `${userId ?? "anonymous"}:${isGuest ? "guest" : "standard"}`;

const reconcilePersistedIdentity = (
  posthog: PostHogInterface,
  identity: AnalyticsIdentity,
  markIdentitySafe: () => void,
) => {
  const expectedAccountId =
    identity.userId === null ? null : String(identity.userId);
  const persistedUserId = posthog.get_property("$user_id");
  const persistedUserState = posthog.get_property("$user_state");
  const persistedAccountId =
    typeof persistedUserId === "string" && persistedUserId.length > 0
      ? persistedUserId
      : persistedUserState === "identified"
        ? posthog.get_distinct_id()
        : null;

  posthog.stopSessionRecording();

  // Persistence is shared with hypertask.ai so anonymous acquisition survives
  // signup. An identified account is different: it must be cleared on logout
  // or account switching before PostHog emits the initial pageview.
  if (
    persistedAccountId !== null &&
    persistedAccountId !== expectedAccountId
  ) {
    posthog.reset();
  }

  posthog.set_config({ disable_session_recording: !identity.isGuest });
  // reset() (when needed) has completed, so captures now belong either to the
  // safe anonymous acquisition identity or to a clean device identity. Open
  // the gate before identify() so its anonymous-to-user link is retained.
  markIdentitySafe();
  if (expectedAccountId !== null) posthog.identify(expectedAccountId);
  if (identity.isGuest) posthog.startSessionRecording();
};

export default function PostHogAnalytics({
  authenticatedUserId,
  authenticatedIsGuest,
}: {
  authenticatedUserId: number | null;
  authenticatedIsGuest: boolean;
}) {
  const currentPathname = usePathname();
  const latestIdentityRef = useRef<AnalyticsIdentity>({
    userId: authenticatedUserId,
    isGuest: authenticatedIsGuest,
  });
  const appliedIdentityRef = useRef<AnalyticsIdentity>(
    latestIdentityRef.current,
  );
  const performanceIdentityKeyRef = useRef(
    identityKey(latestIdentityRef.current),
  );
  const performanceIdentityStartedAtRef = useRef(0);
  // Next Web Vitals are document-scoped, not reset by SPA navigation. Once a
  // document crosses identities, its navigation metrics can never describe
  // the new account. Keep this true for the document lifetime; route-specific
  // Board/Inbox/Calendar readiness is measured by the product event pipeline.
  const documentIdentityTransitionedRef = useRef(false);
  const posthogRef = useRef<PostHogInterface | null>(null);
  const identityReadyRef = useRef(false);
  const initialPageviewRef = useRef<{
    href: string;
    pathname: string;
    title: string;
  } | null>(null);
  const documentRouteTransitionedRef = useRef(false);
  const pendingWebVitalsRef = useRef<
    {
      metric: AppWebVitalMetric;
      identityKey: string;
      identityTransitioned: boolean;
      identityStartedAt: number;
      observedAt: number;
      observedUrl: string;
    }[]
  >([]);
  const scheduleControllerRef = useRef<AnalyticsScheduleController | null>(
    null,
  );
  const analyticsInitializationReadyRef = useRef(false);
  const webVitalsInstallStateRef = useRef<WebVitalsInstallState>("idle");
  const webVitalsInstallAttemptRef = useRef(0);

  useLayoutEffect(() => {
    const committedIdentity = {
      userId: authenticatedUserId,
      isGuest: authenticatedIsGuest,
    };
    const committedIdentityKey = identityKey(committedIdentity);

    latestIdentityRef.current = committedIdentity;
    if (
      posthogRef.current &&
      identityKey(appliedIdentityRef.current) !== committedIdentityKey
    ) {
      // The new identity is now committed. Close capture until the passive
      // reconciliation effect has removed or identified PostHog state.
      identityReadyRef.current = false;
    }

    if (initialPageviewRef.current === null) {
      initialPageviewRef.current = {
        href: window.location.href,
        pathname: window.location.pathname,
        title: document.title,
      };
    } else if (currentPathname !== initialPageviewRef.current.pathname) {
      // Web Vitals describe the document entry, not whichever SPA route is
      // visible when a late callback fires. Only a committed route transition
      // may permanently close this document-scoped metric window.
      documentRouteTransitionedRef.current = true;
    }

    if (performanceIdentityKeyRef.current !== committedIdentityKey) {
      performanceIdentityKeyRef.current = committedIdentityKey;
      documentIdentityTransitionedRef.current = true;
      performanceIdentityStartedAtRef.current = Number.POSITIVE_INFINITY;
      pendingWebVitalsRef.current = [];
    }
  }, [authenticatedIsGuest, authenticatedUserId, currentPathname]);

  const sendProjectWebVital = useCallback(
    (
      posthog: PostHogInterface,
      queued: {
        metric: AppWebVitalMetric;
        identityKey: string;
        identityTransitioned: boolean;
        identityStartedAt: number;
        observedAt: number;
        observedUrl: string;
      },
    ) => {
      const latestIdentity = latestIdentityRef.current;
      if (
        documentRouteTransitionedRef.current ||
        queued.identityKey !== identityKey(latestIdentity) ||
        queued.identityKey !== identityKey(appliedIdentityRef.current) ||
        !metricBelongsToIdentityWindow(
          queued.metric,
          queued.identityTransitioned,
          queued.identityStartedAt,
          queued.observedAt,
        )
      ) {
        return;
      }
      const capture = buildAuthenticatedProjectWebVital({
        metric: queued.metric,
        observedUrl: queued.observedUrl,
        identity: latestIdentity,
        deviceClass: performanceDeviceClass(),
      });
      if (capture) posthog.capture(capture.event, capture.properties);
    },
    [],
  );

  const reportWebVital = useCallback(
    (metric: AppWebVitalMetric) => {
      const documentEntry = initialPageviewRef.current;
      if (!documentEntry || documentRouteTransitionedRef.current) return;
      const latestIdentityKey = identityKey(latestIdentityRef.current);
      if (latestIdentityKey !== identityKey(appliedIdentityRef.current)) {
        return;
      }
      const queued = {
        metric,
        identityKey: latestIdentityKey,
        identityTransitioned: documentIdentityTransitionedRef.current,
        identityStartedAt: performanceIdentityStartedAtRef.current,
        observedAt: performance.now(),
        // Bind the document-scoped metric to the document entry. Query-string
        // identifiers are sanitized by buildAuthenticatedProjectWebVital.
        observedUrl: documentEntry.href,
      };
      const posthog = posthogRef.current;
      if (posthog && identityReadyRef.current) {
        sendProjectWebVital(posthog, queued);
        return;
      }

      const queue = pendingWebVitalsRef.current;
      queue.push(queued);
      if (queue.length > 12) queue.shift();
    },
    [sendProjectWebVital],
  );

  const installAuthenticatedProjectWebVitals = useCallback(async () => {
    const documentEntry = initialPageviewRef.current;
    const identity = latestIdentityRef.current;
    if (
      !analyticsInitializationReadyRef.current ||
      !posthogRef.current ||
      !identityReadyRef.current ||
      !documentEntry ||
      webVitalsInstallStateRef.current !== "idle" ||
      !shouldInstallAuthenticatedProjectWebVitals({
        documentEntryUrl: documentEntry.href,
        identity,
        documentRouteTransitioned: documentRouteTransitionedRef.current,
      })
    ) {
      return;
    }

    // Keep this a separate identity-aware installation gate. Analytics can
    // initialize anonymously and then receive an authenticated server session
    // without re-running the SDK initializer. The dependency's buffered
    // PerformanceObservers retain supported entries from before this import.
    const installAttempt = ++webVitalsInstallAttemptRef.current;
    webVitalsInstallStateRef.current = "installing";
    try {
      const { onCLS, onFCP, onFID, onINP, onLCP, onTTFB } = await import(
        "web-vitals"
      );
      const latestIdentity = latestIdentityRef.current;
      if (
        installAttempt !== webVitalsInstallAttemptRef.current ||
        !analyticsInitializationReadyRef.current ||
        !posthogRef.current ||
        !identityReadyRef.current ||
        !shouldInstallAuthenticatedProjectWebVitals({
          documentEntryUrl: documentEntry.href,
          identity: latestIdentity,
          documentRouteTransitioned: documentRouteTransitionedRef.current,
        })
      ) {
        if (installAttempt === webVitalsInstallAttemptRef.current) {
          webVitalsInstallStateRef.current = "idle";
        }
        return;
      }

      // Mark installed before registering callbacks because buffered entries
      // may invoke a callback synchronously. No later identity effect may add a
      // duplicate set of document observers.
      webVitalsInstallStateRef.current = "installed";
      onCLS(reportWebVital);
      onFCP(reportWebVital);
      onFID(reportWebVital);
      onINP(reportWebVital);
      onLCP(reportWebVital);
      onTTFB(reportWebVital);
    } catch (error) {
      if (installAttempt === webVitalsInstallAttemptRef.current) {
        webVitalsInstallStateRef.current = "idle";
      }
      throw error;
    }
  }, [reportWebVital]);

  useEffect(() => {
    const identity = latestIdentityRef.current;
    const nextIdentityKey = identityKey(identity);
    if (
      documentIdentityTransitionedRef.current &&
      performanceIdentityStartedAtRef.current === Number.POSITIVE_INFINITY
    ) {
      performanceIdentityStartedAtRef.current = performance.now();
    }
    pendingWebVitalsRef.current = pendingWebVitalsRef.current.filter(
      (queued) => queued.identityKey === nextIdentityKey,
    );

    const posthog = posthogRef.current;
    const previousIdentity = appliedIdentityRef.current;
    if (!posthog || identityKey(previousIdentity) === nextIdentityKey) return;

    // Login refreshes the server tree; logout and account switching hard
    // navigate. If identity still changes within this document, remove every
    // trace of the previous user before applying the newly verified session.
    identityReadyRef.current = false;
    posthog.stopSessionRecording();
    // Preserve anonymous -> identified linkage for the marketing-to-app
    // funnel. Reset only when an already identified guest/user changes or
    // signs out, so two real identities can never share PostHog state.
    if (previousIdentity.userId !== null) posthog.reset();
    posthog.set_config({ disable_session_recording: !identity.isGuest });
    identityReadyRef.current = true;
    if (identity.userId !== null) posthog.identify(String(identity.userId));
    if (identity.isGuest) posthog.startSessionRecording();
    appliedIdentityRef.current = identity;
    void installAuthenticatedProjectWebVitals().catch((error) => {
      console.error("[posthog] web vitals initialization failed", error);
    });
  }, [
    authenticatedIsGuest,
    authenticatedUserId,
    installAuthenticatedProjectWebVitals,
  ]);

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    const initialPageview = initialPageviewRef.current ?? {
      href: window.location.href,
      pathname: window.location.pathname,
      title: document.title,
    };
    let cancelled = false;
    let initializationStarted = false;
    let uninstallSink: () => void = () => undefined;
    let idleId: number | null = null;
    let paintSettleTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let noIdleFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const clearSchedule = () => {
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (paintSettleTimer !== null) clearTimeout(paintSettleTimer);
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      if (noIdleFallbackTimer !== null) clearTimeout(noIdleFallbackTimer);
      window.removeEventListener(
        PRODUCT_PERFORMANCE_READY_EVENT,
        scheduleAfterProductReady,
      );
      idleId = null;
      paintSettleTimer = null;
      fallbackTimer = null;
      noIdleFallbackTimer = null;
    };

    const initialize = async () => {
      if (cancelled || initializationStarted) return;
      initializationStarted = true;
      clearSchedule();
      try {
        // HTPR-4883: a guest who rejected optional cookies skips analytics
        // entirely. Unset (not yet asked, or a signed-in user who never sees
        // the banner) keeps the existing capture-by-default behavior.
        if (getCookieConsent() === "essential") return;

        // The app does not use surveys, feature flags, toolbar helpers, or the
        // other optional integrations bundled by the default entrypoint. The
        // supported slim build keeps capture, identity, web vitals, and guest
        // session recording while removing those dormant modules.
        const { default: posthog } = await import(
          "posthog-js/dist/module.slim"
        );
        if (cancelled) return;
        const identity = latestIdentityRef.current;
        posthog.init(key, {
          api_host:
            process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
          // api_host is our own proxy domain, which posthog-js cannot map back to a
          // region, so it would send toolbar/survey links to the US app without this.
          ui_host: "https://eu.posthog.com",
          defaults: "2025-05-24",
          // Same cookie name and scope as the marketing site's snippet, so a visitor
          // who lands on hypertask.ai keeps one identity through signup. Diverge and
          // every signup looks like a brand-new stranger with no acquisition source.
          persistence: "localStorage+cookie",
          persistence_name: "posthog_hypertask",
          cross_subdomain_cookie: true,
          autocapture: true,
          // Replay is for watching what demo guests do with the product; a
          // signed-in user's real work is never recorded.
          disable_session_recording: !identity.isGuest,
          // The app installs one identity-aware observer set below. Keep the
          // SDK's generic observer off so marketing/shared traffic cannot mix
          // with the authenticated app series or double count its metrics.
          capture_performance: false,
          // Give signed-in project vitals a dedicated, exact-host event. The
          // marketing site keeps `$web_vitals`, so its traffic cannot enter the
          // app series even though both surfaces share a PostHog project.
          before_send: (event) => {
            // Fail closed while shared persistence still might belong to a
            // previous account. This also covers SDK captures that happen
            // before the loaded hook, regardless of internal init ordering.
            if (!identityReadyRef.current) return null;
            return scopeProjectWebVitalsEvent(event, {
              userId: latestIdentityRef.current.userId,
              isGuest: latestIdentityRef.current.isGuest,
            });
          },
          // This runs synchronously before PostHog starts its request queue and
          // schedules the initial pageview. Reconcile shared persistence here so
          // a hard logout/account switch cannot emit under the previous account.
          loaded: (loadedPostHog) => {
            const loadedIdentity = latestIdentityRef.current;
            reconcilePersistedIdentity(loadedPostHog, loadedIdentity, () => {
              identityReadyRef.current = true;
            });
            // With authenticated startup intentionally delayed, a fast SPA
            // navigation can happen before PostHog installs history capture.
            // Preserve the true entry route; PostHog will capture the current
            // route immediately after this callback and future history changes.
            if (window.location.href !== initialPageview.href) {
              loadedPostHog.capture("$pageview", {
                $current_url: initialPageview.href,
                $pathname: initialPageview.pathname,
                $title: initialPageview.title,
              });
            }
            posthogRef.current = loadedPostHog;
            appliedIdentityRef.current = loadedIdentity;
            pendingWebVitalsRef.current
              .splice(0)
              .forEach((queued) =>
                sendProjectWebVital(loadedPostHog, queued),
              );
          },
          // We do not run PostHog surveys, but posthog-js loads its surveys
          // bundle anyway: 97 KiB, ~80% unused, the single largest script on the
          // board page. Turning surveys off drops that request entirely.
          disable_surveys: true,
        });
        // Product readiness events are independent of the optional Web Vitals
        // chunk. Install their sink first so a failed delayed chunk request
        // cannot leave Board, Inbox, Calendar, or task telemetry queued.
        uninstallSink = installProductPerformanceSink(
          ({ event, properties }, accountId) => {
            const latestIdentity = latestIdentityRef.current;
            if (
              !identityReadyRef.current ||
              latestIdentity.isGuest ||
              latestIdentity.userId !== accountId ||
              identityKey(latestIdentity) !==
                identityKey(appliedIdentityRef.current)
            ) {
              return;
            }
            posthog.capture(event, properties);
          },
        );
        analyticsInitializationReadyRef.current = true;
        await installAuthenticatedProjectWebVitals().catch((error) => {
          console.error("[posthog] web vitals initialization failed", error);
        });
      } catch (error) {
        console.error("[posthog] initialization failed", error);
      }
    };

    function scheduleInIdlePeriod(
      noIdleDelayMs = 0,
      idleTimeoutMs?: number,
    ) {
      if (cancelled || initializationStarted) return;
      if (typeof window.requestIdleCallback === "function") {
        const initializeWhenIdle = () => void initialize();
        idleId =
          idleTimeoutMs === undefined
            ? window.requestIdleCallback(initializeWhenIdle)
            : window.requestIdleCallback(initializeWhenIdle, {
                timeout: idleTimeoutMs,
              });
      } else if (noIdleDelayMs > 0) {
        noIdleFallbackTimer = setTimeout(
          () => void initialize(),
          noIdleDelayMs,
        );
      } else {
        void initialize();
      }
    }

    function scheduleAfterProductReady() {
      if (cancelled || initializationStarted || paintSettleTimer !== null) return;
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      window.removeEventListener(
        PRODUCT_PERFORMANCE_READY_EVENT,
        scheduleAfterProductReady,
      );
      paintSettleTimer = setTimeout(
        () =>
          scheduleInIdlePeriod(
            0,
            AUTHENTICATED_ANALYTICS_PAINT_SETTLE_MS,
          ),
        AUTHENTICATED_ANALYTICS_PAINT_SETTLE_MS,
      );
    }

    const setAuthenticated = (authenticated: boolean) => {
      if (cancelled || initializationStarted) return;
      clearSchedule();
      if (!authenticated) {
        // Keep anonymous acquisition and login-funnel pageviews on their
        // current idle schedule. Only the authenticated app pays the
        // paint-first delay.
        scheduleInIdlePeriod(ANONYMOUS_ANALYTICS_FALLBACK_MS);
        return;
      }

      window.addEventListener(
        PRODUCT_PERFORMANCE_READY_EVENT,
        scheduleAfterProductReady,
      );
      fallbackTimer = setTimeout(
        () => void initialize(),
        AUTHENTICATED_ANALYTICS_MAX_WAIT_MS,
      );

      // A fast IndexedDB restore can beat this component's passive effect.
      // The bounded queue is authoritative, so handle that race without
      // requiring another product event.
      if (
        window.__hypertaskProductPerformanceQueue?.some(
          isProductReadinessEvent,
        )
      ) {
        scheduleAfterProductReady();
      }
    };

    const scheduleController = { setAuthenticated };
    scheduleControllerRef.current = scheduleController;

    return () => {
      cancelled = true;
      analyticsInitializationReadyRef.current = false;
      if (webVitalsInstallStateRef.current === "installing") {
        webVitalsInstallAttemptRef.current += 1;
        webVitalsInstallStateRef.current = "idle";
      }
      clearSchedule();
      uninstallSink();
      posthogRef.current = null;
      if (scheduleControllerRef.current === scheduleController) {
        scheduleControllerRef.current = null;
      }
    };
  }, [installAuthenticatedProjectWebVitals, sendProjectWebVital]);

  useEffect(() => {
    scheduleControllerRef.current?.setAuthenticated(
      authenticatedUserId !== null,
    );
  }, [authenticatedUserId]);

  return null;
}
