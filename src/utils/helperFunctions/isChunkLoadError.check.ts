// Runnable check for the PERT-89 stale-bundle detector.
// Run: node --experimental-strip-types src/utils/helperFunctions/isChunkLoadError.check.ts
import assert from "node:assert";
// @ts-ignore -- explicit .ts extension is required by `node --experimental-strip-types`
import { isChunkLoadError } from "./isChunkLoadError.ts";

// Webpack names the error explicitly -> caught by name even without a message.
assert.strictEqual(isChunkLoadError({ name: "ChunkLoadError" }), true, "name match");

// Classic webpack message -> caught.
assert.strictEqual(
  isChunkLoadError(new Error("Loading chunk 472 failed.\n(missing: https://app/_next/x.js)")),
  true,
  "loading chunk failed",
);

// CSS chunk variant -> caught.
assert.strictEqual(
  isChunkLoadError(new Error("Loading CSS chunk 12 failed. (https://app/_next/x.css)")),
  true,
  "loading css chunk failed",
);

// ESM / Safari dynamic-import variants -> caught.
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

// An unrelated runtime error -> NOT a chunk error (don't auto-reload real bugs).
assert.strictEqual(
  isChunkLoadError(new TypeError("Cannot read properties of null (reading 'id')")),
  false,
  "real bug is not a chunk error",
);

// Junk inputs -> false, never throws.
assert.strictEqual(isChunkLoadError(null), false, "null");
assert.strictEqual(isChunkLoadError(undefined), false, "undefined");
assert.strictEqual(isChunkLoadError("Loading chunk 1 failed"), false, "string, not error object");
assert.strictEqual(isChunkLoadError({ message: 123 }), false, "non-string message");

console.log("isChunkLoadError: all checks passed");
