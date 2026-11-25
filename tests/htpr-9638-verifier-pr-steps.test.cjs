const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier.mjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };

const BODY = `## Why
A named MCP refusal is caller fixable, so it must never file a feedback ticket.

## What changed
- \`src/lib/aiFeedback/callerFixable.ts\` reads its codes from the Refusal registry.

## Scope
Part 3 only.

## Blast Radius
\`callerCanFix\` is read by \`observeFeedbackTools\`.

## Verification
API-only, no page step, MCP bearer token. Keep \`{task}\`; the harness fills it.

1. \`POST /api/mcp/tasks/attachments\`, body \`{"task_id": "{task}", "files": [{"filename": "page.png", "content_type": "image/png", "url": "http://127.0.0.1/x.png"}]}\`. Require 400, response text \`failed_files\`. Real response:
\`{"success":false,"attachment_status":"failed","attachments":[],"failed_files":[{"index":0,"filename":"page.png","error":"URL resolves to a disallowed (private/reserved) address"}]}\`
2. \`POST /api/mcp/tasks/update\`, body \`{"task_id": "{task}", "status": "Bogus"}\`. Require 400, response text \`allowed_values\`. Real response:
\`{"success":false,"error":"Invalid status.","code":"invalid_field","field":"status","allowed_values":["Normal","Archive","Deleted"]}\`

Both are caller-fixable 400s. Do not plan a step against \`/api/mcp/feedback\`: it files a ticket, and \`{"code":"not_found"}\` answers 400 with \`Unrecognized key\`.

Author-Model: codex
`;

const request = {
  ...binding,
  baseSha: "b".repeat(40),
  title: "HTPR-9612 [IMPROVE] Named MCP refusals keep their detail",
  body: BODY,
  diff: "",
  files: ["src/lib/aiFeedback/callerFixable.ts"],
  filesTruncated: false,
  boardPath: "/project?id={id}",
  taskPath: "/detail/project-{id}/1",
};

test("a body with a Verification section puts its API calls first in the change plan", async () => {
  const { planFromRequest, verificationCandidates } = await load();
  const invented = { op: "api", method: "POST", path: "/api/mcp/feedback", body: { code: "not_found", status: 400, surface: "mcp" }, expectStatus: 200, expectText: "ok" };
  const prompts = [];
  const plan = await planFromRequest(request, {
    binding,
    pages: [],
    sources: [],
    readSource: () => "",
    ground: { corpus: "", routes: [] },
    ask(prompt) {
      prompts.push(prompt);
      return { actions: [invented], expect: [], reason: "the diff reaches /api/mcp/feedback" };
    },
  });
  const candidates = verificationCandidates(BODY);
  assert.deepEqual(candidates.map((item) => `${item.method} ${item.path} ${item.expectStatus} ${item.expectText}`), [
    "POST /api/mcp/tasks/attachments 400 failed_files",
    "POST /api/mcp/tasks/update 400 allowed_values",
  ]);
  assert.equal(candidates[0].body.task_id, "{task}");
  assert.equal(candidates[0].body.files[0].filename, "page.png");
  assert.equal(candidates[1].body.status, "Bogus");
  assert.match(prompts[0], /Verification or How to verify section that names concrete user steps or API calls/);
  assert.match(prompts[0], /Never plan a success status on an endpoint the body says answers an error/);
  assert.deepEqual(plan.actions, candidates);
  assert.equal(plan.actions.some((action) => action.path === "/api/mcp/feedback"), false);
  assert.equal(plan.unevaluated, "");
});

test("a failing api step records the response status and body text in the evidence", async () => {
  const { runPlan } = await load();
  const raw = '{"success":false,"error":"body: Unrecognized key: \\"code\\""}';
  const page = { request: { async fetch() { return { status: () => 400, text: async () => raw }; } } };
  const plan = { actions: [{ op: "api", method: "POST", path: "/api/mcp/tasks/{task}", body: {}, expectStatus: 200, expectText: "ok" }], expect: [] };
  const result = await runPlan({ page, plan, base: "http://127.0.0.1:9", projectId: "1", taskId: "2", bearer: "token-value", agentBearer: "", archivedProjectId: "3", agentId: "11111111-1111-4111-8111-111111111111", shotsDir: "/tmp", navigations: [] });
  const step = result.steps[0];
  assert.equal(step.ok, false);
  assert.equal(step.error, "api status 400");
  assert.equal(step.status, 400);
  assert.equal(step.text, raw);
  assert.doesNotMatch(step.text, /token-value/);
});

test("a verification step keeps its safe query string and the drive asks that exact path", async () => {
  const { verificationCandidates, withVerificationSteps, runPlan } = await load();
  const body = `## Verification
1. \`GET /api/mcp/chat/pending?unanswered=true\`. Require 200, response text \`questions\`.
2. \`GET /api/mcp/chat/messages?limit=20&agent={agent}\`. Require 200, response text \`messages\`.
`;
  const candidates = verificationCandidates(body);
  assert.deepEqual(candidates.map((item) => `${item.method} ${item.path}`), [
    "GET /api/mcp/chat/pending?unanswered=true",
    "GET /api/mcp/chat/messages?limit=20&agent={agent}",
  ]);
  const routes = ["src/pages/api/mcp/chat/pending.ts", "src/pages/api/mcp/chat/messages.ts"];
  const documented = withVerificationSteps({ actions: [{ op: "api", method: "GET", path: "/api/mcp/chat/pending", body: {}, expectStatus: 200, expectText: "ok" }], expect: [] }, body, { routes, corpus: "" });
  assert.deepEqual(documented.actions.map((item) => item.path), ["/api/mcp/chat/pending?unanswered=true", "/api/mcp/chat/messages?limit=20&agent={agent}"]);
  const asked = [];
  const page = { request: { async fetch(url) { asked.push(url); return { status: () => 200, text: async () => "questions" }; } } };
  const plan = { actions: [{ op: "api", method: "GET", path: "/api/mcp/chat/pending?unanswered=true", body: {}, expectStatus: 200, expectText: "questions" }], expect: [] };
  const result = await runPlan({ page, plan, base: "http://127.0.0.1:9", projectId: "1", taskId: "2", bearer: "token-value", agentBearer: "agent-token", archivedProjectId: "3", agentId: "11111111-1111-4111-8111-111111111111", shotsDir: "/tmp", navigations: [] });
  assert.equal(result.steps[0].ok, true);
  assert.deepEqual(asked, ["http://127.0.0.1:9/api/mcp/chat/pending?unanswered=true"]);
});

test("distinct documented calls to one endpoint are all kept and planner copies are dropped", async () => {
  const { verificationCandidates, withVerificationSteps } = await load();
  const body = `## Verification
1. \`POST /api/mcp/tasks/update\`, body \`{"task_id": "{task}", "status": "Bogus"}\`. Require 400, response text \`allowed_values\`.
2. \`POST /api/mcp/tasks/update\`, body \`{"task_id": "{task}", "priority": "Nope"}\`. Require 400, response text \`allowed_values\`.
3. \`POST /api/mcp/tasks/update\`, body \`{"task_id": "{task}", "status": "Bogus"}\`. Require 400, response text \`allowed_values\`.
`;
  const candidates = verificationCandidates(body);
  assert.deepEqual(candidates.map((item) => `${item.method} ${item.path} ${JSON.stringify(item.body)}`), [
    'POST /api/mcp/tasks/update {"task_id":"{task}","status":"Bogus"}',
    'POST /api/mcp/tasks/update {"task_id":"{task}","priority":"Nope"}',
  ]);
  const planner = [
    { op: "api", method: "POST", path: "/api/mcp/tasks/update", body: { task_id: "{task}", status: "Normal" }, expectStatus: 200, expectText: "saved" },
    { op: "api", method: "GET", path: "/api/mcp/tasks/{task}", body: {}, expectStatus: 200, expectText: "ok" },
  ];
  const merged = withVerificationSteps({ actions: planner, expect: [] }, body, { corpus: "", routes: [] });
  assert.equal(merged.actions.length, 3);
  assert.equal(merged.actions.some((action) => action.path === "/api/mcp/tasks/update" && action.expectStatus === 200), false);
  assert.deepEqual(merged.actions.slice(0, 2), candidates);
  assert.deepEqual(merged.actions[2], planner[1]);
});
