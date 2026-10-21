
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

export const MY_TASKS_TABLE_COLUMN_KEYS = [
    "ticket",
    "title",
    "board",
    "status",
    "assignee",
    "priority",
    "size",
    "labels",
    "due",
    "created",
    "updated",
] as const;
export type MyTasksTableColumnKey = (typeof MY_TASKS_TABLE_COLUMN_KEYS)[number];

export const DEFAULT_MY_TASKS_TABLE_COLUMNS: MyTasksTableColumnKey[] = [
    "ticket",
    "title",
    "assignee",
    "priority",
    "size",
    "due",
    "updated",
];

export const MY_TASKS_TABLE_COLUMN_LABELS: Record<MyTasksTableColumnKey, string> = {
    ticket: "Ticket",
    title: "Title",
    board: "Board",
    status: "Column",
    assignee: "Assignee",
    priority: "Priority",
    size: "Size",
    labels: "Labels",
    due: "Due",
    created: "Created",
    updated: "Updated",
};

export const TABLE_STALENESS_COLUMNS: TableColumnKey[] = [
    "inColumn",
    "noComment",
    "onBoard",
];

const CUSTOM_FIELD_COLUMN_PREFIX = "customField:";
export const customFieldColumnKey = (fieldId: string) => `${CUSTOM_FIELD_COLUMN_PREFIX}${fieldId}`;
export const isCustomFieldColumnKey = (key: string): boolean => key.startsWith(CUSTOM_FIELD_COLUMN_PREFIX);
export const customFieldIdFromColumnKey = (key: string) => key.slice(CUSTOM_FIELD_COLUMN_PREFIX.length);

export const LOCKED_TABLE_COLUMNS = new Set<string>(["ticket", "title"]);

const normalizeLockedFrontColumns = (
    value: unknown,
    isValidKey: (key: unknown) => key is string,
    fallback: readonly string[],
): string[] => {
    if (!Array.isArray(value) || value.length === 0 || value.some((key) => !isValidKey(key))) {
        return [...fallback];
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

export const normalizeTableVisibleColumns = (value: unknown): string[] => {
    const isValidKey = (key: unknown): key is string =>
        typeof key === "string" && (TABLE_COLUMN_KEYS.includes(key as TableColumnKey) || isCustomFieldColumnKey(key));
    return normalizeLockedFrontColumns(value, isValidKey, DEFAULT_TABLE_COLUMNS);
};

export const normalizeMyTasksTableVisibleColumns = (value: unknown): string[] => {
    const allowed = new Set<string>(MY_TASKS_TABLE_COLUMN_KEYS);
    const isValidKey = (key: unknown): key is string =>
        typeof key === "string" && allowed.has(key);
    return normalizeLockedFrontColumns(value, isValidKey, DEFAULT_MY_TASKS_TABLE_COLUMNS);
};

export const withForcedStatusWhileSorted = (
    normalized: string[],
    sortActive: boolean,
    forceStatusWhileSorted: boolean,
): string[] => {
    if (!forceStatusWhileSorted || !sortActive || normalized.includes("status")) {
        return normalized;
    }
    if (normalized.length < 2) return normalized;
    return [normalized[0], normalized[1], "status", ...normalized.slice(2)];
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

export const seedMissingCustomFieldColumns = (visible: string[], customFieldKeys: string[]): string[] => {
    const present = new Set(visible);
    const missing = customFieldKeys.filter((key) => !present.has(key));
    return missing.length ? [...visible, ...missing] : visible;
};
