export const PROJECT_HEALTH_VALUES = ["OnTrack", "AtRisk", "OffTrack"] as const;

export type ProjectHealthValue = (typeof PROJECT_HEALTH_VALUES)[number];

export const projectPlanningQueryKey = (projectId: number) =>
  ["projectPlanning", projectId] as const;

export const PROJECT_HEALTH_LABELS: Record<ProjectHealthValue, string> = {
  OnTrack: "On track",
  AtRisk: "At risk",
  OffTrack: "Off track",
};

export const parseDateOnly = (value: unknown): Date | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }

  return parsed;
};

export const toDateOnly = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString().slice(0, 10) : null;

export const parseProjectHealth = (
  value: unknown,
): ProjectHealthValue | null =>
  PROJECT_HEALTH_VALUES.includes(value as ProjectHealthValue)
    ? (value as ProjectHealthValue)
    : null;

export const cleanPlanningText = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > maxLength) return null;
  return cleaned;
};
