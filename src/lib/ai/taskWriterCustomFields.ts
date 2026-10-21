import { parse } from "node-html-parser";

export type TaskWriterCustomFieldDefinition = {
  id: string;
  name: string;
  type: string;
  options?: unknown;
};

export type TaskWriterCustomFieldValue = { fieldId: string; value: string | number };

export function readTaskWriterCustomFields(html: string) {
  const root = parse(html);
  const markers = root.querySelectorAll("#ai-generated-task-custom-fields");
  let customFields: unknown = [];
  try {
    customFields = JSON.parse(markers[0]?.text ?? "[]");
  } catch {}
  for (const marker of markers) marker.remove();
  return { html: root.innerHTML, customFields };
}

export function validateTaskWriterCustomFields(
  definitions: TaskWriterCustomFieldDefinition[],
  input: unknown,
): TaskWriterCustomFieldValue[] {
  if (!Array.isArray(input)) return [];
  const values = new Map<string, TaskWriterCustomFieldValue>();
  for (const entry of input.slice(0, 50)) {
    if (!entry || typeof entry !== "object") continue;
    const field = definitions.find((field) => field.id === entry.fieldId);
    if (!field || (typeof entry.value !== "string" && typeof entry.value !== "number")) continue;
    let value: string | number = typeof entry.value === "string" ? entry.value.trim() : entry.value;
    if (value === "" || (typeof value === "number" && !Number.isFinite(value))) continue;
    if (field.type === "Number") {
      value = Number(value);
      if (!Number.isFinite(value)) continue;
    } else if (field.type === "Select") {
      const options = Array.isArray(field.options) ? field.options : [];
      const option = options.find((option) => option && typeof option === "object" &&
        (option.id === value || option.label === value));
      if (!option || typeof option.label !== "string") continue;
      value = option.label;
    } else if (field.type === "Text") {
      value = String(value).slice(0, 2000);
    } else if (field.type === "Date") {
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) continue;
    } else if (field.type === "Checkbox") {
      if (value !== "true" && value !== "false") continue;
    } else continue;
    values.set(field.id, { fieldId: field.id, value });
  }
  return [...values.values()];
}
