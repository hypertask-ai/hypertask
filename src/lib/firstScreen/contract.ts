export type FirstScreenFlags = {
  accountId: number;
  evaluatedAt: string;
  values: Record<string, boolean>;
};

export type FirstScreenDisplayPreferences = {
  version: 1;
  accountId: number;
  timeZone: string;
  locale: string;
  boardLayout: "board" | "table";
  theme: "porcelain" | "graphite" | "amoled" | "dia";
  railCollapsed: boolean;
  quickTips: boolean;
  draftsFirst: boolean;
};

export type FirstScreenScope = {
  accountId: number;
  route: string;
  generation: string;
};

// Unknown browser-only preferences must keep using the existing client path.
export function hasFirstScreenDisplayPreferences(
  value: unknown,
  accountId: number,
): value is FirstScreenDisplayPreferences {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<FirstScreenDisplayPreferences>;
  if (p.version !== 1 || p.accountId !== accountId ||
      !["board", "table"].includes(p.boardLayout ?? "") ||
      !["porcelain", "graphite", "amoled", "dia"].includes(p.theme ?? "") ||
      typeof p.railCollapsed !== "boolean" || typeof p.quickTips !== "boolean" ||
      typeof p.draftsFirst !== "boolean" || !p.timeZone || !p.locale) return false;
  try {
    new Intl.DateTimeFormat(p.locale, { timeZone: p.timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export type FirstScreenWireValue =
  | null | boolean | number | string
  | FirstScreenWireValue[]
  | { [key: string]: FirstScreenWireValue };

export type FirstScreenInitialModel<T extends FirstScreenWireValue> = {
  schemaVersion: 1;
  buildVersion: string;
  scope: FirstScreenScope;
  authorization: { outcome: "authorized"; checkedAt: string };
  fetchedAt: string;
  now: string;
  display: FirstScreenDisplayPreferences;
  flags: FirstScreenFlags;
  completeness: "complete" | "display-only";
  // An active board is never a complete projectsAll authorization response.
  projectsCompleteness: "active-board-only" | "all-authorized";
  selection: { view: string | null; surface: "board" | "table" | null; split: number | null; focus: string | null };
  data: T;
};
