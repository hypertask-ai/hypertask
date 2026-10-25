export const FEATURE_FLAG_REMOVAL_DAYS: 14;
export const BUGFIX_FLAG_REMOVAL_DAYS: 7;
export const FLAG_REMOVAL_TICKETS_PER_RUN: 10;

export function removalWindowDays(flag: { kind?: string | null; highRisk?: string | null }): number;

type RemovalRow = {
  key: string;
  mode: string;
  releasedAt: Date | string | null;
  keep?: boolean | null;
  removalTaskId?: number | null;
  kind?: string | null;
  highRisk?: string | null;
};

export function selectDueFlags<T extends RemovalRow>(rows: readonly T[], now?: Date): T[];
