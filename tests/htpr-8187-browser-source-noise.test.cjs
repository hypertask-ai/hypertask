const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jiti = require("jiti").createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "../src") },
});

const {
  dropNetworkBlipException,
  dropSelfRecoveringChunkLoadException,
} = jiti("../src/lib/analytics/browserNoise.ts");
const script = new URL("../.github/scripts/posthog-error-issues.mjs", `file://${__filename}`);
const ID = "01a188bc-95e1-7bc2-a142-75ca68ee1623";

const exceptionEvent = (entries) => ({
  uuid: "event-1",
  event: "$exception",
  properties: {
    $current_url: "https://app.hypertask.ai/detail/project-339/1844",
    $lib: "web",
    $exception_list: entries.map((entry, index) => ({
      ...entry,
      mechanism: { exception_id: index, handled: false, synthetic: false, type: "generic" },
    })),
  },
});

test("the real AxiosError network blip behind HTPR-8187 never reaches PostHog error tracking", () => {
  const networkBlip = exceptionEvent([{ type: "AxiosError", value: "Network Error" }]);
  assert.equal(dropNetworkBlipException(networkBlip), null);
  const pageview = { event: "$pageview", properties: {} };
  assert.equal(dropNetworkBlipException(pageview), pageview);
});

test("a real browser exception still reaches PostHog", () => {
  const crash = exceptionEvent([{ type: "TypeError", value: "Cannot read properties of undefined (reading 'id')" }]);
  assert.equal(dropNetworkBlipException(crash), crash);
  const mixed = exceptionEvent([
    { type: "AxiosError", value: "Network Error" },
    { type: "TypeError", value: "Cannot read properties of undefined (reading 'id')" },
  ]);
  assert.equal(dropNetworkBlipException(mixed), mixed);
  const responseError = exceptionEvent([
    { type: "AxiosError", value: "Request failed with status code 500" },
  ]);
  assert.equal(dropNetworkBlipException(responseError), responseError);
});

test("chunk-load filtering keeps working next to the network blip filter", () => {
  const staleChunk = exceptionEvent([
    {
      type: "ChunkLoadError",
      value:
        "Loading chunk 10295 failed.\n(error: https://app.hypertask.ai/_next/static/chunks/10295.ed4945978da0b9fa.js?dpl=dpl_6xhr4m2SeLFFd7egY4qFYMYjoyat)",
    },
  ]);
  assert.equal(dropSelfRecoveringChunkLoadException(staleChunk), null);
  assert.equal(dropNetworkBlipException(staleChunk), staleChunk);
});

test("a browser-captured issue is read as browser, titled Browser error and rated P2", async () => {
  const { issueQuery, readProductionIssue } = await import(script);
  const { plainTitle, plainSummary } = await import("../src/lib/errors/plainIncident.mjs");
  assert.match(
    issueQuery(ID),
    /argMax\(coalesce\(properties\.ht_source, if\(properties\.\$lib = 'web', 'browser', 'server'\)\), timestamp\)/,
  );

  const row = [1, 1, "2026-10-29T17:37:00Z", "2026-10-29T17:37:00Z", JSON.stringify([{ type: "AxiosError", value: "Network Error" }]), "browser", "https://app.hypertask.ai/detail/project-339/1844", 0, null];
  const response = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  const issue = await readProductionIssue(
    async (url) => response(url.includes("/issues/") ? { id: ID } : { results: [row] }),
    "fixture",
    ID,
  );

  assert.equal(issue.source, "browser");
  assert.equal(issue.severity, "P2");
  assert.equal(
    plainTitle({ url: issue.url, message: issue.message, source: issue.source }),
    "Browser error on a ticket page: an unexpected error",
  );
  assert.match(
    plainSummary({ url: issue.url, message: issue.message, source: issue.source }),
    /Something failed in the browser while someone was using a ticket page/,
  );
});
