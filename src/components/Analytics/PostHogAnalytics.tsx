"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { PostHogInterface } from "posthog-js/dist/module.slim";

import { getCookieConsent, onCookieConsentChange } from "@/lib/cookieConsent";
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
import { dropResizeObserverLoopException } from "@/lib/analytics/browserNoise";
import { installBrowserCaptureSink } from "@/lib/analytics/browserCapture";

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

  if (
    persistedAccountId !== null &&
    persistedAccountId !== expectedAccountId
  ) {
    posthog.reset();
  }

  posthog.set_config({ disable_session_recording: !identity.isGuest });
  markIdentitySafe();
  if (expectedAccountId !== null) posthog.identify(expectedAccountId);
  if (identity.isGuest) posthog.startSessionRecording();
};

export default function PostHogAnalytics({
  authenticatedUserId,
  authenticatedIsGuest,
  identifyEventIds = false,
}: {
  authenticatedUserId: number | null;
  authenticatedIsGuest: boolean;
  identifyEventIds?: boolean;
}) {
  const currentPathname = usePathname();
  const identifyEventIdsRef = useRef(identifyEventIds);
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
    identifyEventIdsRef.current = identifyEventIds;
    if (
      posthogRef.current &&
      identityKey(appliedIdentityRef.current) !== committedIdentityKey
    ) {
      identityReadyRef.current = false;
    }

    if (initialPageviewRef.current === null) {
      initialPageviewRef.current = {
        href: window.location.href,
        pathname: window.location.pathname,
        title: document.title,
      };
    } else if (currentPathname !== initialPageviewRef.current.pathname) {
      documentRouteTransitionedRef.current = true;
    }

    if (performanceIdentityKeyRef.current !== committedIdentityKey) {
      performanceIdentityKeyRef.current = committedIdentityKey;
      documentIdentityTransitionedRef.current = true;
      performanceIdentityStartedAtRef.current = Number.POSITIVE_INFINITY;
      pendingWebVitalsRef.current = [];
    }
  }, [authenticatedIsGuest, authenticatedUserId, currentPathname, identifyEventIds]);

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

    const installAttempt = ++webVitalsInstallAttemptRef.current;
    webVitalsInstallStateRef.current = "installing";
    try {
      const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import("web-vitals");
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

      webVitalsInstallStateRef.current = "installed";
      onCLS(reportWebVital);
      onFCP(reportWebVital);
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

    identityReadyRef.current = false;
    posthog.stopSessionRecording();
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
    let uninstallBrowserSink: () => void = () => undefined;
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
        if (getCookieConsent() === "essential") return;

        const [{ default: posthog }, { ErrorTrackingExtensions }] =
          await Promise.all([
            import("posthog-js/dist/module.slim"),
            import("posthog-js/dist/extension-bundles"),
          ]);
        if (cancelled) return;
        const identity = latestIdentityRef.current;
        posthog.init(key, {
          api_host:
            process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
          ui_host: "https://eu.posthog.com",
          defaults: "2025-05-24",
          persistence: "localStorage+cookie",
          persistence_name: "posthog_hypertask",
          cross_subdomain_cookie: true,
          autocapture: true,
          __extensionClasses: ErrorTrackingExtensions,
          capture_exceptions: true,
          disable_session_recording: !identity.isGuest,
          capture_performance: false,
          before_send: (event) => {
            if (!identityReadyRef.current) return null;
            if (
              event?.event === "$identify" &&
              latestIdentityRef.current.userId !== null &&
              identifyEventIdsRef.current
            ) {
              event.properties.event_id = event.uuid;
              event.properties.source = "web";
            }
            return scopeProjectWebVitalsEvent(
              dropResizeObserverLoopException(event),
              {
                userId: latestIdentityRef.current.userId,
                isGuest: latestIdentityRef.current.isGuest,
              },
            );
          },
          loaded: (loadedPostHog) => {
            const loadedIdentity = latestIdentityRef.current;
            reconcilePersistedIdentity(loadedPostHog, loadedIdentity, () => {
              identityReadyRef.current = true;
            });
            if (window.location.href !== initialPageview.href) {
              loadedPostHog.capture("$pageview", {
                $current_url: initialPageview.href,
                $pathname: initialPageview.pathname,
                $title: initialPageview.title,
              });
            }
            posthogRef.current = loadedPostHog;
            appliedIdentityRef.current = loadedIdentity;
            uninstallBrowserSink = installBrowserCaptureSink(({ event, properties }) => {
              if (
                getCookieConsent() === "essential" ||
                !identityReadyRef.current ||
                properties.user_id !== (latestIdentityRef.current.userId === null ? null : String(latestIdentityRef.current.userId))
              ) return;
              loadedPostHog.capture(event, properties, { uuid: properties.event_id });
            });
            pendingWebVitalsRef.current
              .splice(0)
              .forEach((queued) =>
                sendProjectWebVital(loadedPostHog, queued),
              );
          },
          disable_surveys: true,
        });
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
      uninstallBrowserSink();
      posthogRef.current = null;
      if (scheduleControllerRef.current === scheduleController) {
        scheduleControllerRef.current = null;
      }
    };
  }, [installAuthenticatedProjectWebVitals, sendProjectWebVital]);

  useEffect(
    () =>
      onCookieConsentChange((consent) => {
        const posthog = posthogRef.current;
        if (!posthog || consent !== "essential") return;
        posthog.stopSessionRecording();
        posthog.opt_out_capturing();
      }),
    [],
  );

  useEffect(() => {
    scheduleControllerRef.current?.setAuthenticated(
      authenticatedUserId !== null,
    );
  }, [authenticatedUserId]);

  return null;
}
