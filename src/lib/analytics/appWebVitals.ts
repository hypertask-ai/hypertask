import {
  AUTHENTICATED_APP_HOSTNAME,
  PROJECT_ROUTE_PATH,
  PROJECT_WEB_VITAL_EVENT,
  type AppPerformanceIdentity,
  isAuthenticatedProjectUrl,
} from "./appPerformanceScope";

export type AppWebVitalMetric = {
  id: string;
  name: string;
  value: number;
  delta?: number;
  rating?: string;
  navigationType?: string;
  entries?: Array<{ startTime: number }>;
};

const SUPPORTED_WEB_VITALS = new Set([
  "CLS",
  "FCP",
  "FID",
  "INP",
  "LCP",
  "TTFB",
]);

export const metricBelongsToIdentityWindow = (
  metric: AppWebVitalMetric,
  identityTransitioned: boolean,
  identityStartedAt: number,
  observedAt: number,
): boolean => {
  if (!identityTransitioned) return true;
  if (observedAt < identityStartedAt) return false;

  // Navigation metrics belong to the document that began before an in-place
  // login. Only post-transition interaction entries can safely represent the
  // newly signed-in session without forcing a slower hard navigation.
  const metricName = metric.name.toUpperCase();
  if (metricName !== "INP" && metricName !== "FID") return false;
  const entries = metric.entries ?? [];
  return (
    entries.length > 0 &&
    entries.every(
      (entry) =>
        Number.isFinite(entry.startTime) &&
        entry.startTime >= identityStartedAt,
    )
  );
};

export const shouldInstallAuthenticatedProjectWebVitals = ({
  documentEntryUrl,
  identity,
  documentRouteTransitioned,
}: {
  documentEntryUrl: string;
  identity: AppPerformanceIdentity;
  documentRouteTransitioned: boolean;
}): boolean => {
  if (
    identity.userId === null ||
    identity.isGuest ||
    documentRouteTransitioned
  ) {
    return false;
  }

  try {
    return isAuthenticatedProjectUrl(new URL(documentEntryUrl));
  } catch {
    return false;
  }
};

export const buildAuthenticatedProjectWebVital = ({
  metric,
  observedUrl,
  identity,
  deviceClass,
}: {
  metric: AppWebVitalMetric;
  observedUrl: string;
  identity: AppPerformanceIdentity;
  deviceClass: "mobile" | "desktop";
}): {
  event: typeof PROJECT_WEB_VITAL_EVENT;
  properties: Record<string, unknown>;
} | null => {
  if (identity.userId === null || identity.isGuest) return null;

  let url: URL;
  try {
    url = new URL(observedUrl);
  } catch {
    return null;
  }
  if (!isAuthenticatedProjectUrl(url)) return null;

  const metricName = metric.name.toUpperCase();
  if (!SUPPORTED_WEB_VITALS.has(metricName) || !Number.isFinite(metric.value)) {
    return null;
  }

  return {
    event: PROJECT_WEB_VITAL_EVENT,
    properties: {
      analytics_surface: "authenticated_app",
      app_hostname: AUTHENTICATED_APP_HOSTNAME,
      $current_url: `${url.origin}${PROJECT_ROUTE_PATH}`,
      $pathname: PROJECT_ROUTE_PATH,
      route_family: "project",
      route_path: PROJECT_ROUTE_PATH,
      device_class: deviceClass,
      app_speed_scope_version: 2,
      web_vital_name: metricName,
      web_vital_id: metric.id,
      web_vital_delta: metric.delta,
      web_vital_rating: metric.rating,
      web_vital_navigation_type: metric.navigationType,
      [`$web_vitals_${metricName}_value`]: metric.value,
    },
  };
};
