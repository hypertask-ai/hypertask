import type { ILabel } from "@/models/model";

type FilterPayloadItem = Record<string, unknown>;

type PersistedFilter = {
  type?: unknown;
  match?: unknown;
  searchPayload?: unknown;
};

type PersistedFilterSettings = {
  matchFilters?: unknown;
  addedFilters?: unknown;
};

type SmartSplitView = {
  id: string;
  board_filters?: unknown;
};

type SmartSplitLabel = {
  id: string;
  value?: string | null;
  ai_prompt?: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const labelFilterEntries = (boardFilters: unknown): PersistedFilter[] => {
  const settings = asRecord(boardFilters) as PersistedFilterSettings | null;
  if (!Array.isArray(settings?.addedFilters)) return [];
  return settings.addedFilters.filter(
    (entry): entry is PersistedFilter => asRecord(entry)?.type === "Labels"
  );
};

export const getLabelReferences = (boardFilters: unknown): string[] =>
  labelFilterEntries(boardFilters).flatMap((entry) =>
    Array.isArray(entry.searchPayload)
      ? entry.searchPayload.flatMap((item) => {
          const id = asRecord(item)?.id;
          return typeof id === "string" && id ? [id] : [];
        })
      : []
  );

/**
 * New smart splits have a stable, schema-free pairing: the view and smart label
 * share an id. Legacy splits are still inferred when exactly one saved
 * view references exactly one smart label.
 */
export const getSmartSplitLabel = <T extends SmartSplitLabel>(
  view: SmartSplitView,
  labels: ReadonlyArray<T>,
  savedViews: ReadonlyArray<SmartSplitView> = [view]
): T | null => {
  const smartLabels = new Map(
    labels
      .filter((label) => Boolean(label.ai_prompt?.trim()))
      .map((label) => [label.id, label] as const)
  );
  const references = getLabelReferences(view.board_filters);
  const pairedLabel = smartLabels.get(view.id);
  if (pairedLabel && references.includes(pairedLabel.id)) return pairedLabel;

  const matches = references.flatMap((labelId) => {
    const label = smartLabels.get(labelId);
    return label ? [label] : [];
  });
  if (matches.length !== 1) return null;
  const legacyLabel = matches[0];
  const linkedViews = savedViews.filter((candidate) =>
    getLabelReferences(candidate.board_filters).includes(legacyLabel.id)
  );
  return linkedViews.length === 1 && linkedViews[0]?.id === view.id
    ? legacyLabel
    : null;
};

export const getManagedSmartLabelIds = (
  views: ReadonlyArray<SmartSplitView>,
  labels: ReadonlyArray<SmartSplitLabel>
): Set<string> => new Set(
  views.flatMap((view) => {
    const label = getSmartSplitLabel(view, labels, views);
    return label ? [label.id] : [];
  })
);

export const getProtectedSmartLabelIds = (
  views: ReadonlyArray<SmartSplitView> | undefined,
  labels: ReadonlyArray<SmartSplitLabel>
): Set<string> => Array.isArray(views)
  ? getManagedSmartLabelIds(views, labels)
  : new Set(
      labels
        .filter((label) => Boolean(label.ai_prompt?.trim()))
        .map((label) => label.id)
    );

export const buildSmartSplitBoardFilters = (
  label: Pick<ILabel, "id" | "value">
) => ({
  matchFilters: "ALL" as const,
  addedFilters: [
    {
      type: "Labels" as const,
      match: "ANY" as const,
      searchPayload: [{ id: label.id, value: label.value }],
    },
  ],
});

export const replaceLabelNameInBoardFilters = (
  boardFilters: unknown,
  labelId: string,
  nextValue: string
): unknown => {
  const settings = asRecord(boardFilters);
  if (!settings || !Array.isArray(settings.addedFilters)) return boardFilters;

  let changed = false;
  const addedFilters = settings.addedFilters.map((entry) => {
    const filter = asRecord(entry);
    if (filter?.type !== "Labels" || !Array.isArray(filter.searchPayload)) {
      return entry;
    }
    const searchPayload = filter.searchPayload.map((item) => {
      const payload = asRecord(item);
      if (payload?.id !== labelId || payload.value === nextValue) return item;
      changed = true;
      return { ...payload, value: nextValue } satisfies FilterPayloadItem;
    });
    return changed ? { ...filter, searchPayload } : entry;
  });

  return changed ? { ...settings, addedFilters } : boardFilters;
};

export const removeLabelFromBoardFilters = (
  boardFilters: unknown,
  labelId: string
): unknown => {
  const settings = asRecord(boardFilters);
  if (!settings || !Array.isArray(settings.addedFilters)) return boardFilters;

  let changed = false;
  const addedFilters = settings.addedFilters.flatMap((entry) => {
    const filter = asRecord(entry);
    if (filter?.type !== "Labels" || !Array.isArray(filter.searchPayload)) {
      return [entry];
    }
    const searchPayload = filter.searchPayload.filter((item) => {
      const shouldRemove = asRecord(item)?.id === labelId;
      if (shouldRemove) changed = true;
      return !shouldRemove;
    });
    if (searchPayload.length === 0) return [];
    return [{ ...filter, searchPayload }];
  });

  return changed ? { ...settings, addedFilters } : boardFilters;
};
