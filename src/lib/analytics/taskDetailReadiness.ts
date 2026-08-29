export const TASK_DETAIL_NAVIGATION_STORAGE_KEY = "ht-task-detail-navigation-start-v1";
export const TASK_DETAIL_READINESS_MAX_MS = 30_000;
export const TASK_DETAIL_CONTENT_READY_SELECTOR = "#description-input .ProseMirror";
export const TASK_DETAIL_ACTIONS_READY_SELECTOR = '[data-task-detail-primary-actions="true"]';
export type TaskDetailMeasuredEntryPath = "board" | "inbox" | "calendar";
type EntryPath = TaskDetailMeasuredEntryPath | "direct_route" | "unknown";
type Exclusion = "none" | "missing_start_marker" | "duration_out_of_range";
type Marker = {
  version: 1;
  entryPath: TaskDetailMeasuredEntryPath;
  targetPath: string;
  startedAt: number;
};
export type TaskDetailReadinessSample = {
  entryPath: EntryPath;
  navigationMode: "client_navigation" | "hard_navigation" | "unknown";
  navigationType: string;
  durationMs: number | null;
  measurementEligible: boolean;
  exclusionReason: Exclusion;
};
export const taskDetailEntryPathForRoute = (pathname: string | null) => {
  if (pathname === "/project" || pathname?.startsWith("/project/")) return "board";
  if (pathname === "/inbox" || pathname?.startsWith("/inbox/")) return "inbox";
  if (pathname === "/calendar" || pathname?.startsWith("/calendar/")) return "calendar";
  return null;
};
export const markTaskDetailNavigationStart = (
  entryPath: TaskDetailMeasuredEntryPath,
  targetUrl: string,
) => {
  if (typeof window === "undefined") return;
  try {
    const marker: Marker = {
      version: 1,
      entryPath,
      targetPath: new URL(targetUrl, window.location.href).pathname,
      startedAt: performance.now(),
    };
    sessionStorage.setItem(TASK_DETAIL_NAVIGATION_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // The destination records unavailable storage as an excluded sample.
  }
};
const parseMarker = (value: string | null): Marker | null => {
  try {
    const marker = JSON.parse(value ?? "null") as Marker | null;
    return marker?.version === 1 &&
      ["board", "inbox", "calendar"].includes(marker.entryPath) &&
      typeof marker.targetPath === "string" &&
      Number.isFinite(marker.startedAt)
      ? marker
      : null;
  } catch {
    return null;
  }
};
const timedSample = (
  entryPath: EntryPath,
  navigationMode: TaskDetailReadinessSample["navigationMode"],
  navigationType: string,
  durationMs: number,
): TaskDetailReadinessSample => {
  const measurementEligible =
    Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= TASK_DETAIL_READINESS_MAX_MS;
  return {
    entryPath,
    navigationMode,
    navigationType,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    measurementEligible,
    exclusionReason: measurementEligible ? "none" : "duration_out_of_range",
  };
};
export const resolveTaskDetailReadinessSample = ({
  currentPath,
  now,
  navigationEntry,
  storedMarker,
}: {
  currentPath: string;
  now: number;
  navigationEntry: Pick<PerformanceNavigationTiming, "name" | "startTime" | "type"> | null;
  storedMarker: string | null;
}): TaskDetailReadinessSample => {
  const marker = parseMarker(storedMarker);
  if (marker?.targetPath === currentPath) {
    return timedSample(marker.entryPath, "client_navigation", "spa", now - marker.startedAt);
  }
  let navigationPath: string | null = null;
  try {
    navigationPath = navigationEntry ? new URL(navigationEntry.name).pathname : null;
  } catch {}
  if (navigationEntry && navigationPath === currentPath) {
    return timedSample(
      "direct_route",
      "hard_navigation",
      navigationEntry.type,
      now - navigationEntry.startTime,
    );
  }
  return {
    entryPath: "unknown",
    navigationMode: "unknown",
    navigationType: "unknown",
    durationMs: null,
    measurementEligible: false,
    exclusionReason: "missing_start_marker",
  };
};

export const consumeTaskDetailReadinessSample = () => {
  let storedMarker: string | null = null;
  try {
    storedMarker = sessionStorage.getItem(TASK_DETAIL_NAVIGATION_STORAGE_KEY);
    sessionStorage.removeItem(TASK_DETAIL_NAVIGATION_STORAGE_KEY);
  } catch {}
  const navigationEntry = (performance.getEntriesByType("navigation")[0] ?? null) as
    | PerformanceNavigationTiming
    | null;
  return resolveTaskDetailReadinessSample({
    currentPath: location.pathname,
    now: performance.now(),
    navigationEntry,
    storedMarker,
  });
};

export const taskDetailUsableDomPresent = (root: ParentNode) =>
  Boolean(
    root.querySelector(TASK_DETAIL_CONTENT_READY_SELECTOR) &&
      root.querySelector(TASK_DETAIL_ACTIONS_READY_SELECTOR),
  );
