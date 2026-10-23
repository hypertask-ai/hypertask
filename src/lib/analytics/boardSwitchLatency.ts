import {
  AUTHENTICATED_APP_HOSTNAME,
  performanceDeviceClass,
} from "@/lib/analytics/appPerformanceScope";
import type { BoardReadinessCompletion } from "@/lib/analytics/boardReadinessPhases";
import { emitProductPerformanceEvent } from "@/lib/analytics/productPerformance";

export type BoardSwitchSurface = "sidebar" | "keyboard_shortcut" | "mobile";

const MAX_INTENT_AGE_MS = 30_000;

type BoardSwitchIntent = {
  surface: BoardSwitchSurface;
  projectId: number;
  markedAt: number;
};

declare global {
  interface Window {
    __htBoardSwitchIntent?: BoardSwitchIntent;
  }
}

export const markBoardSwitchIntent = ({
  surface,
  projectId,
}: {
  surface: BoardSwitchSurface;
  projectId: number;
}): void => {
  if (typeof window === "undefined" || typeof performance === "undefined") {
    return;
  }
  window.__htBoardSwitchIntent = { surface, projectId, markedAt: performance.now() };
};

export const resolveBoardSwitchIntent = (
  completion: BoardReadinessCompletion,
): void => {
  if (typeof window === "undefined" || typeof performance === "undefined") {
    return;
  }
  const intent = window.__htBoardSwitchIntent;
  if (!intent || intent.projectId !== completion.projectId) return;
  delete window.__htBoardSwitchIntent;

  const durationMs = performance.now() - intent.markedAt;
  if (durationMs < 0 || durationMs > MAX_INTENT_AGE_MS) return;
  if (
    !completion.authenticated ||
    window.location.hostname !== AUTHENTICATED_APP_HOSTNAME
  ) {
    return;
  }

  emitProductPerformanceEvent(
    {
      event: "app_board_switch_latency",
      properties: {
        analytics_surface: "authenticated_app",
        app_hostname: window.location.hostname,
        route_family: "project",
        view_surface: completion.viewSurface,
        switch_surface: intent.surface,
        readiness_source: completion.readinessSource,
        duration_ms: Math.max(0, Math.round(durationMs)),
        device_class: performanceDeviceClass(),
        project_id: completion.projectId,
        switch_measurement_version: 1,
        switch_measurement_scope: "board_switch_intent_to_usable",
      },
    },
    completion.accountId,
  );
};
