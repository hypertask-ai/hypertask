import type { CaptureResult } from "posthog-js";

export const AUTHENTICATED_APP_HOSTNAME = "app.hypertask.ai";
export const PROJECT_ROUTE_PATH = "/project";
export const PROJECT_WEB_VITAL_EVENT = "app_project_web_vitals";

export type AppPerformanceIdentity = {
  userId: number | null;
  isGuest: boolean;
};

const eventUrl = (event: CaptureResult): URL | null => {
  const currentUrl = event.properties?.$current_url;
  if (typeof currentUrl !== "string") return null;

  try {
    return new URL(currentUrl);
  } catch {
    return null;
  }
};

export const isAuthenticatedProjectUrl = (url: URL): boolean =>
  url.hostname === AUTHENTICATED_APP_HOSTNAME &&
  url.pathname === PROJECT_ROUTE_PATH;

export const performanceDeviceClass = (): "mobile" | "desktop" =>
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 767px)").matches
    ? "mobile"
    : "desktop";

/**
 * Give authenticated project Web Vitals their own event name and strict scope.
 * Marketing continues to use PostHog's built-in `$web_vitals` event, so the
 * app series cannot accidentally include hypertask.ai landing-page traffic.
 */
export const scopeProjectWebVitalsEvent = (
  event: CaptureResult | null,
  identity: AppPerformanceIdentity,
): CaptureResult | null => {
  if (!event || event.event !== "$web_vitals") return event;
  if (identity.userId === null || identity.isGuest) return event;

  const url = eventUrl(event);
  if (!url || !isAuthenticatedProjectUrl(url)) return event;

  return {
    ...event,
    event: PROJECT_WEB_VITAL_EVENT,
    properties: {
      ...event.properties,
      analytics_surface: "authenticated_app",
      app_hostname: AUTHENTICATED_APP_HOSTNAME,
      route_family: "project",
      route_path: PROJECT_ROUTE_PATH,
      device_class: performanceDeviceClass(),
      app_speed_scope_version: 1,
    },
  };
};
