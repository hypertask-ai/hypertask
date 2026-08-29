type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type CloneResult =
  | { ok: true; value: JsonValue }
  | { ok: false };

const invalidClone: CloneResult = { ok: false };

function cloneJsonValue(value: unknown, ancestors: WeakSet<object>): CloneResult {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return { ok: true, value };
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? { ok: true, value } : invalidClone;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? invalidClone
      : { ok: true, value: value.toISOString() };
  }

  if (typeof value !== "object") return invalidClone;

  const prototype = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    return invalidClone;
  }
  if (ancestors.has(value)) return invalidClone;

  ancestors.add(value);
  try {
    if (isArray) {
      const cloned: JsonValue[] = [];
      for (const item of value) {
        if (item === undefined) {
          cloned.push(null);
          continue;
        }
        const result = cloneJsonValue(item, ancestors);
        if (!result.ok) return invalidClone;
        cloned.push(result.value);
      }
      return { ok: true, value: cloned };
    }

    const cloned: { [key: string]: JsonValue } = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      const result = cloneJsonValue(item, ancestors);
      if (!result.ok) return invalidClone;
      cloned[key] = result.value;
    }
    return { ok: true, value: cloned };
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Build the browser-to-API task payload from JSON-safe root fields only.
 *
 * React state can accidentally contain DOM events, Window, File, or another
 * cyclic object. Axios stringifies request bodies before sending them, so one
 * such optional field used to prevent the entire task from being created.
 */
export function createSerializableTaskPayload(
  input: Record<string, unknown>
): Record<string, JsonValue> {
  const payload: Record<string, JsonValue> = Object.create(null);

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const result = cloneJsonValue(value, new WeakSet<object>());
    if (result.ok) payload[key] = result.value;
  }

  return payload;
}
