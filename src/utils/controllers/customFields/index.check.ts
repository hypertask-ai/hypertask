import assert from "node:assert";


function computeNumericValue(type: string, value: string): number | null {
  if (type === "Number") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  if (type === "Date") {
    const parsed = Date.parse(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

assert.strictEqual(computeNumericValue("Number", "3.14"), 3.14, "valid float");
assert.strictEqual(computeNumericValue("Number", "42"), 42, "integer string");
assert.strictEqual(computeNumericValue("Number", "abc"), null, "non-numeric → null");
assert.strictEqual(computeNumericValue("Number", ""), null, "empty string → null");
assert.ok(
  typeof computeNumericValue("Date", "2024-01-15") === "number" &&
    computeNumericValue("Date", "2024-01-15")! > 0,
  "valid ISO date → epoch ms"
);
assert.strictEqual(computeNumericValue("Date", "not-a-date"), null, "invalid date → null");
assert.strictEqual(computeNumericValue("Text", "hello"), null, "Text type → null");
assert.strictEqual(computeNumericValue("Checkbox", "true"), null, "Checkbox type → null");


function shouldDelete(value: string | null): boolean {
  return value === null || value === "";
}

assert.ok(shouldDelete(null), "null triggers delete");
assert.ok(shouldDelete(""), "empty string triggers delete");
assert.ok(!shouldDelete("0"), "zero string does NOT trigger delete");
assert.ok(!shouldDelete("false"), "'false' string does NOT trigger delete");

console.log("All checks passed.");
