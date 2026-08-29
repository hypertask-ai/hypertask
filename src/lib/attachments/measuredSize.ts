/**
 * Attachment sizes arrive from browser clients, so they are untrusted input.
 * Editor uploads used to store a hardcoded "1", which made every attachment
 * claim it was one byte long and fail the download integrity check. Storing a
 * bad number is the same failure with extra steps, so anything that is not a
 * plain non-negative integer is recorded as "not measured" instead.
 */
export function measuredSizeString(value: unknown): string | null {
  // Numeric strings are accepted because that is how the size round-trips
  // through the database column and back into an editor save.
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  // Only plain decimal digits. Number() would otherwise accept "0x10", "1e3",
  // and whitespace-padded forms, none of which a size column should contain.
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const size = Number(value);
  return Number.isSafeInteger(size) ? String(size) : null;
}

/** Same validation, as the number the URL payload carries. */
export function measuredSizeNumber(value: unknown): number | undefined {
  const size = measuredSizeString(value);
  return size === null ? undefined : Number(size);
}
