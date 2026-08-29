export type ProjectTimeTrackingUpdate = {
  showTimeTotals?: boolean;
  timeTrackingEnabled?: boolean;
};

export function projectTimeTrackingUpdate(
  body: unknown,
): ProjectTimeTrackingUpdate | null {
  if (!body || typeof body !== "object") return null;
  const input = body as { enabled?: unknown; showTimeTotals?: unknown };
  const hasEnabled = typeof input.enabled === "boolean";
  const hasShowTimeTotals = typeof input.showTimeTotals === "boolean";
  if (!hasEnabled && !hasShowTimeTotals) return null;

  return {
    ...(hasEnabled ? { timeTrackingEnabled: input.enabled as boolean } : {}),
    ...(input.enabled === false
      ? { showTimeTotals: false }
      : hasShowTimeTotals
      ? { showTimeTotals: input.showTimeTotals as boolean }
      : {}),
  };
}

export function projectTimeTrackingUpdateGuard(
  data: ProjectTimeTrackingUpdate,
) {
  return data.showTimeTotals === true
    ? { timeTrackingEnabled: true as const }
    : {};
}

export function projectTimeTrackingResponse(data: ProjectTimeTrackingUpdate) {
  return {
    success: true as const,
    enabled: data.timeTrackingEnabled,
    ...data,
  };
}
