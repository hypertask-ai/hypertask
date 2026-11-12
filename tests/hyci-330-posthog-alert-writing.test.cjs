const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const jiti = require("jiti").createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "../src") },
});

const { assertAgentWriting } = jiti("../src/lib/agents/writing.ts");

async function alertWriter() {
  return import(pathToFileURL(path.resolve(__dirname, "../.github/scripts/posthog-error-alert.mjs")).href);
}

async function issueWriter() {
  return import(pathToFileURL(path.resolve(__dirname, "../.github/scripts/posthog-error-issues.mjs")).href);
}

const issue = {
  issue_id: "01a1cfe0-a88a-79c1-8b2d-f0633ba7684e",
  event_id: "01a1cfe0-a9cb-7071-a520-b2d033cf5cf7",
  name: "Error",
  message: "MCP POST /mcp/tasks/update failed with McpServerErrorWithoutCause",
  count: 3,
  users: 1,
  unidentified_hits: 2,
  timestamp: "2026-11-12T13:09:30.846Z",
  last_seen: "2026-11-12T13:10:00.000Z",
  source: "server",
  url: "https://app.hypertask.ai/api/mcp/tasks/update",
  issue_url: "https://eu.posthog.com/project/236160/error_tracking/01a1cfe0-a88a-79c1-8b2d-f0633ba7684e",
  severity: "P2",
  severity_reason: "A feature failed for some users; no confirmed crash or data loss.",
  alert_kind: "issue_created",
};

const alerts = [
  ["created P2", issue],
  [
    "created P1 usage persistence",
    {
      ...issue,
      severity: "P1",
      severity_reason: "A crash or failed durable accounting needs urgent investigation.",
      user_impact: "AI may finish answering, but its usage is not saved. Usage totals and allowance may be wrong.",
    },
  ],
  [
    "created P1 browser",
    {
      ...issue,
      severity: "P1",
      source: "client",
      message: "Minified React error #418",
      severity_reason: "A crash or failed durable accounting needs urgent investigation.",
      user_impact: "The page stops working or shows an error fallback. The requested content does not appear.",
    },
  ],
  [
    "created P3 allowance",
    {
      ...issue,
      severity: "P3",
      severity_reason: "An expected plan limit or missing AI key, not a crash.",
      user_impact: "AI stops until the team adds a key or renews the allowance.",
    },
  ],
  [
    "reopened prisma lookup",
    {
      ...issue,
      alert_kind: "issue_reopened",
      message: "prisma.team.findUnique() invocation failed",
      user_impact: "A page that needs team details fails to load. It may show an error.",
    },
  ],
  ["spiking with a flag", { ...issue, alert_kind: "issue_spiking", spike_count: 187, spike_baseline: 12, feature_flag: "htpr-8798-writing-house-rules" }],
  ["empty AI reply", { ...issue, message: "No output generated", user_impact: "The requested AI reply or draft is empty." }],
];

test("every alert kind and severity produces a description the ticket API accepts", async () => {
  const { incidentDescription } = await alertWriter();
  const { hasPlainLanguageTicketBlock, missingPlainLanguageTicketLabels } = await import(
    pathToFileURL(path.resolve(__dirname, "../src/lib/tickets/plainLanguageTicket.mjs")).href
  );
  for (const [label, alert] of alerts) {
    const description = incidentDescription(alert);
    assert.ok(hasPlainLanguageTicketBlock(description), `${label}: plain block missing ${missingPlainLanguageTicketLabels(description).join(", ")}`);
    assert.ok(description.includes(`PostHog issue ID: <code>${alert.issue_id}</code>`), `${label}: dedupe marker missing`);
    assert.ok(description.includes(`posthog-alert:${alert.alert_kind}:${alert.event_id}`), `${label}: monitor marker missing`);
    assert.doesNotThrow(
      () => assertAgentWriting("agent", { description }, {}, { create: true, houseRules: true }),
      `${label}: description refused by the agent writing rules`,
    );
  }
});

test("a repeat alert records one plain agent log entry", async () => {
  const { issueLogText } = await issueWriter();
  const entry = issueLogText({ ...issue, severity_label_id: "p2" }, [{ id: "p1", name: "P1" }]);
  assert.match(entry.split("\n")[0], /^PostHog reported this issue again\.$/);
  assert.match(entry, /Production hits: 3\. Known users: 1\. Hits without a user identity: 2\./);
  assert.match(entry, /Severity changed from P1 to P2\./);
  assert.match(entry, /Record findings here\.$/);
  assert.doesNotMatch(entry, /<(?:p|li|div|br)\b/i);
});

test("a refused create names the API refusal instead of only the status", async () => {
  const { jsonRequest } = await alertWriter();
  const refusal = { success: false, message: "description: Keep each sentence within twelve words" };
  const fetchImpl = async () => new Response(JSON.stringify(refusal), { status: 400, headers: { "Content-Type": "application/json" } });
  await assert.rejects(
    () => jsonRequest(fetchImpl, "https://app.hypertask.ai/api/mcp/tasks/create", { method: "POST" }),
    /returned HTTP 400: description: Keep each sentence within twelve words/,
  );
});

test("a repeat alert writes to the agent log, never an untyped people comment", async () => {
  const { logIssueActivity } = await issueWriter();
  const posts = [];
  const fetchImpl = async (url, options = {}) => {
    posts.push({ url, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith("/api/mcp/agents/runs")) return new Response(JSON.stringify({ success: true, run: { id: `run-${posts.length}` } }), { status: 201 });
    if (posts.length === 2) return new Response(JSON.stringify({ success: false, error: "run is not active" }), { status: 409 });
    return new Response(JSON.stringify({ success: true, activity: { id: "a1" } }), { status: 201 });
  };
  await logIssueActivity(fetchImpl, "token", { appUrl: "https://app.hypertask.ai" }, { id: 100 }, "key", "PostHog reported this issue again.");
  assert.deepEqual(posts.map((post) => post.url.replace("https://app.hypertask.ai", "")), [
    "/api/mcp/agents/runs",
    "/api/mcp/agents/runs/run-1/activities",
    "/api/mcp/agents/runs",
    "/api/mcp/agents/runs/run-3/activities",
  ]);
  assert.deepEqual(posts[1].body, { type: "thought", text: "PostHog reported this issue again." });
  assert.equal(posts.some((post) => post.url.endsWith("/api/mcp/comments")), false);
});
