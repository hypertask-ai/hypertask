const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/mcp-dry-run.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { buildFieldError } = jiti(
  path.join(root, "src/lib/mcp/fieldError.ts")
);

test("includes the stable code and offending field", () => {
  const error = buildFieldError("invalid_field", "priority", "Invalid priority");

  assert.equal(error.code, "invalid_field");
  assert.equal(error.field, "priority");
});

test("includes allowed_values only when provided", () => {
  const withoutAllowedValues = buildFieldError(
    "missing_field",
    "title",
    "Title is required"
  );
  const withAllowedValues = buildFieldError(
    "invalid_field",
    "content_type",
    "Invalid content type",
    ["html", "markdown"]
  );

  assert.equal("allowed_values" in withoutAllowedValues, false);
  assert.deepEqual(withAllowedValues.allowed_values, ["html", "markdown"]);
});

test("preserves the human-readable error message", () => {
  const message = "Comment text is required";

  assert.equal(buildFieldError("missing_field", "text", message).error, message);
});
