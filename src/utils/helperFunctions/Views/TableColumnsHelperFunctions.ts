// Pure helpers for the table view's visible-column order (picker + drag-to-reorder).
// Kept free of Recoil/atom imports so this module (and its test) can be
// imported on its own instead of pulling in the whole store graph.

export const TABLE_COLUMN_KEYS = [
    "ticket",
    "title",
    "status",
    "assignee",
    "priority",
    "size",
    "due",
    "inColumn",
    "noComment",
    "onBoard",
    "time",
    "created",
    "updated",
] as const;
export type TableColumnKey = (typeof TABLE_COLUMN_KEYS)[number];

export const DEFAULT_TABLE_COLUMNS: TableColumnKey[] = [
    "ticket",
    "title",
    "assignee",
    "priority",
    "size",
    "due",
    "updated",
];

export const TABLE_STALENESS_COLUMNS: TableColumnKey[] = [
    "inColumn",
    "noComment",
    "onBoard",
];

// Custom-field table columns use the same "customField:<id>" key format as
// the table's sort-column state (see TableView's CustomFieldSortColumn), so
// a dragged field's position and its active sort column line up on one key.
const CUSTOM_FIELD_COLUMN_PREFIX = "customField:";
export const customFieldColumnKey = (fieldId: string) => `${CUSTOM_FIELD_COLUMN_PREFIX}${fieldId}`;
export const isCustomFieldColumnKey = (key: string): boolean => key.startsWith(CUSTOM_FIELD_COLUMN_PREFIX);
export const customFieldIdFromColumnKey = (key: string) => key.slice(CUSTOM_FIELD_COLUMN_PREFIX.length);

// Ticket/title always lead the table (title needs to be flex-width and predictable in
// position), so neither drag-reorder (header) nor the picker's drag list lets them move.
export const LOCKED_TABLE_COLUMNS = new Set<string>(["ticket", "title"]);

// Order-preserving: 'ticket'/'title' are locked to the front, the rest keep
// whatever order the user last dragged them into (TableColumnsPicker).
// Accepts both built-in keys and 'customField:<id>' entries, so custom
// fields share the exact same toggle + reorder + persistence as the
// built-in columns: presence in the array means visible, same as any
// built-in. A key simply absent from the array is hidden — deliberately,
// no different from a user having unchecked "Status".
export const normalizeTableVisibleColumns = (value: unknown): string[] => {
    const isValidKey = (key: unknown): key is string =>
        typeof key === "string" && (TABLE_COLUMN_KEYS.includes(key as TableColumnKey) || isCustomFieldColumnKey(key));

    if (!Array.isArray(value) || value.length === 0 || value.some((key) => !isValidKey(key))) {
        return [...DEFAULT_TABLE_COLUMNS];
    }

    const seen = new Set<string>();
    const rest: string[] = [];
    for (const key of value as string[]) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (key !== "ticket" && key !== "title") rest.push(key);
    }
    return ["ticket", "title", ...rest];
};

export const setTableStalenessColumns = (visible: string[], enabled: boolean): string[] => {
    const normalized = normalizeTableVisibleColumns(visible);
    const stalenessColumns = new Set<string>(TABLE_STALENESS_COLUMNS);

    if (!enabled) {
        return normalized.filter((key) => !stalenessColumns.has(key));
    }

    const present = new Set(normalized);
    const missing = TABLE_STALENESS_COLUMNS.filter((key) => !present.has(key));
    return missing.length ? [...normalized, ...missing] : normalized;
};

// Unlike built-ins (a fixed, compile-time-known set that DEFAULT_TABLE_COLUMNS
// seeds once), custom fields are created at runtime — a field a user has never
// seen needs seeding into the stored order exactly once, same as
// DEFAULT_TABLE_COLUMNS seeds the built-ins for a first-time user. After that
// one seed, presence/absence is purely the user's own toggle choice. Callers
// seed once per newly-discovered field (see TableView's seeding effect) and
// on "Reset to default" (which re-seeds all of them, visible again).
export const seedMissingCustomFieldColumns = (visible: string[], customFieldKeys: string[]): string[] => {
    const present = new Set(visible);
    const missing = customFieldKeys.filter((key) => !present.has(key));
    return missing.length ? [...visible, ...missing] : visible;
};
