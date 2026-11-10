export type RightColumnFieldKey =
  | "assignees"
  | "agents"
  | "dueDate"
  | "cycle"
  | "priority"
  | "size"
  | "tags";

export interface RightColumnFieldValues {
  assigneeCount: number;
  agentCount: number;
  dueDate: unknown;
  cyclesEnabled: boolean;
  cycle: unknown;
  priority: unknown;
  size: string | undefined;
  tagValues: ReadonlyArray<string | null | undefined>;
}

interface RightColumnField {
  key: RightColumnFieldKey;
  label: string;
  isFilled: (values: RightColumnFieldValues) => boolean;
  isAvailable?: (values: RightColumnFieldValues) => boolean;
}

export const RIGHT_COLUMN_FIELDS: ReadonlyArray<RightColumnField> = [
  { key: "assignees", label: "Assignee", isFilled: (v) => v.assigneeCount > 0 },
  { key: "agents", label: "Agent", isFilled: (v) => v.agentCount > 0 },
  { key: "dueDate", label: "Due date", isFilled: (v) => Boolean(v.dueDate) },
  {
    key: "cycle",
    label: "Cycle",
    isFilled: (v) => Boolean(v.cycle),
    isAvailable: (v) => v.cyclesEnabled,
  },
  { key: "priority", label: "Priority", isFilled: (v) => Boolean(v.priority) },
  { key: "size", label: "Size", isFilled: (v) => Boolean(v.size) && v.size !== "-" },
  { key: "tags", label: "Tags", isFilled: (v) => v.tagValues.some(Boolean) },
];

export type FilledRightColumnFields = Record<RightColumnFieldKey, boolean>;

export function filledRightColumnFields(
  values: RightColumnFieldValues,
): FilledRightColumnFields {
  return Object.fromEntries(
    RIGHT_COLUMN_FIELDS.map((field) => [field.key, field.isFilled(values)]),
  ) as FilledRightColumnFields;
}

export interface CustomFieldEntry {
  id: number;
  name: string;
}

export interface CustomFieldValueEntry {
  fieldId: number;
  value: string;
}

export function isCustomFieldFilled(
  fieldId: number,
  values: ReadonlyArray<CustomFieldValueEntry> | undefined,
): boolean {
  return Boolean(values?.find((entry) => entry.fieldId === fieldId)?.value);
}

export interface AddFieldOption {
  key: string;
  label: string;
}

export const customFieldOptionKey = (fieldId: number) => `custom:${fieldId}`;

export function customFieldIdFromOptionKey(key: string): number | null {
  if (!key.startsWith("custom:")) return null;
  const id = Number(key.slice("custom:".length));
  return Number.isInteger(id) ? id : null;
}

export function addFieldOptions(
  values: RightColumnFieldValues,
  customFields: ReadonlyArray<CustomFieldEntry>,
  customValues: ReadonlyArray<CustomFieldValueEntry> | undefined,
): AddFieldOption[] {
  const builtIn = RIGHT_COLUMN_FIELDS.filter(
    (field) => (field.isAvailable?.(values) ?? true) && !field.isFilled(values),
  ).map((field) => ({ key: field.key, label: field.label }));
  const custom = customFields
    .filter((field) => !isCustomFieldFilled(field.id, customValues))
    .map((field) => ({ key: customFieldOptionKey(field.id), label: field.name }));
  return [...builtIn, ...custom];
}

export const ADD_FIELD_EVENT = "task-add-field";
export const ADD_FIELD_COMMAND_PREFIX = "addField:";

export interface AddFieldEventDetail {
  taskId: number;
  key: string;
}

export interface AddFieldPalettePayload {
  taskId: number;
  options: AddFieldOption[];
}
