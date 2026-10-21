import assert from "node:assert";
// @ts-expect-error Node strip-types checks require .ts imports without allowImportingTsExtensions.
import { isChunkLoadError } from "./isChunkLoadError.ts";

assert.strictEqual(isChunkLoadError({ name: "ChunkLoadError" }), true, "name match");

assert.strictEqual(
  isChunkLoadError(new Error("Loading chunk 472 failed.\n(missing: https://app/_next/x.js)")),
  true,
  "loading chunk failed",
);

assert.strictEqual(
  isChunkLoadError(new Error("Loading CSS chunk 12 failed. (https://app/_next/x.css)")),
  true,
  "loading css chunk failed",
);

assert.strictEqual(
  isChunkLoadError(new Error("Failed to fetch dynamically imported module: https://app/x.js")),
  true,
  "esm dynamic import",
);
assert.strictEqual(
  isChunkLoadError(new Error("Importing a module script failed.")),
  true,
  "safari module script",
);

assert.strictEqual(
  isChunkLoadError(new TypeError("Cannot read properties of null (reading 'id')")),
  false,
  "real bug is not a chunk error",
);

assert.strictEqual(isChunkLoadError(null), false, "null");
assert.strictEqual(isChunkLoadError(undefined), false, "undefined");
assert.strictEqual(isChunkLoadError("Loading chunk 1 failed"), false, "string, not error object");
assert.strictEqual(isChunkLoadError({ message: 123 }), false, "non-string message");

console.log("isChunkLoadError: all checks passed");
