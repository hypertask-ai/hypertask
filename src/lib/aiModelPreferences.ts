export const AI_MODEL_PREFERENCE_SURFACES = [
  "aiChat",
  "taskWriter",
  "writeWithAi",
  "improveWriting",
  "askAi",
  "imageGeneration",
] as const;

export type TAiModelPreferenceSurface =
  (typeof AI_MODEL_PREFERENCE_SURFACES)[number];

export type TAiModelPreferencesBySurface = Partial<
  Record<TAiModelPreferenceSurface, string>
>;

export type TAiModelPreferences = TAiModelPreferencesBySurface & {
  teams?: Record<string, TAiModelPreferencesBySurface>;
};

export function isAiModelPreferenceSurface(
  value: string,
): value is TAiModelPreferenceSurface {
  return AI_MODEL_PREFERENCE_SURFACES.includes(
    value as TAiModelPreferenceSurface,
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeTeamId(teamId: string | number | null | undefined) {
  if (teamId === null || teamId === undefined) return null;
  const normalized = String(teamId).trim();
  return normalized || null;
}

export function getAiModelPreferenceIds(
  preferences: TAiModelPreferences | null | undefined,
  surface: TAiModelPreferenceSurface,
  teamId: string | number | null | undefined,
) {
  const storedPreferences = asRecord(preferences);
  const normalizedTeamId = normalizeTeamId(teamId);
  const teams = asRecord(storedPreferences?.teams);
  const teamPreferences = normalizedTeamId
    ? asRecord(teams?.[normalizedTeamId])
    : null;

  return {
    teamScoped:
      typeof teamPreferences?.[surface] === "string"
        ? teamPreferences[surface]
        : undefined,
    global:
      typeof storedPreferences?.[surface] === "string"
        ? storedPreferences[surface]
        : undefined,
  };
}

export function mergeAiModelPreferenceUpdates(
  preferences: TAiModelPreferences | null | undefined,
  updates: TAiModelPreferencesBySurface,
  teamId?: string | number | null,
): TAiModelPreferences {
  const storedPreferences = asRecord(preferences) ?? {};
  const normalizedTeamId = normalizeTeamId(teamId);

  if (!normalizedTeamId) {
    return { ...storedPreferences, ...updates } as TAiModelPreferences;
  }

  const teams = asRecord(storedPreferences.teams) ?? {};
  const teamPreferences = asRecord(teams[normalizedTeamId]) ?? {};

  return {
    ...storedPreferences,
    teams: {
      ...teams,
      [normalizedTeamId]: {
        ...teamPreferences,
        ...updates,
      },
    },
  } as TAiModelPreferences;
}
