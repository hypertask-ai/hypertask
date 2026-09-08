const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const scriptUrl = pathToFileURL(
  path.resolve(__dirname, "../scripts/configure-posthog-error-alert.mjs"),
).href;

test("finds an existing destination after the first PostHog page", async () => {
  const { findDestination } = await import(scriptUrl);
  const calls = [];
  const match = await findDestination(
    "https://eu.posthog.com/api/projects/123/hog_functions",
    { Authorization: "Bearer test" },
    async (url) => {
      calls.push(url);
      if (calls.length === 1) {
        return {
          results: [{ id: "other", name: "Another destination" }],
          next: "https://eu.posthog.com/api/projects/123/hog_functions?offset=100&limit=100",
        };
      }
      return {
        results: [
          {
            id: "existing",
            name: "Hypertask server exceptions to rollback relay",
          },
        ],
        next: null,
      };
    },
  );

  assert.equal(match.id, "existing");
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1],
    "https://eu.posthog.com/api/projects/123/hog_functions?offset=100&limit=100",
  );
});

test("rejects pagination outside the configured PostHog endpoint", async () => {
  const { findDestination } = await import(scriptUrl);
  await assert.rejects(
    findDestination(
      "https://eu.posthog.com/api/projects/123/hog_functions",
      {},
      async () => ({ results: [], next: "https://example.com/steal" }),
    ),
    /pagination is invalid/,
  );
});
