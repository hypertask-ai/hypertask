const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readCatalog, identity, collectSources, diffModels } = require("../scripts/model-diff");
const { ticketFor, fileFindings } = require("../.github/scripts/ai-model-watch.cjs");
const fixture = require("./fixtures/model-diff.json");
const root = path.resolve(__dirname, "..");
const catalog = readCatalog(fs.readFileSync(path.join(root, "src/lib/aiModelOptions.ts"), "utf8"));
const report = () => diffModels(catalog, structuredClone(fixture));
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function assertPickerModelsListed(sources) {
  const missing = diffModels(catalog, sources).findings.filter((finding) => finding.reason === "picker model missing from gateway list");
  assert.deepEqual(missing, [], "Every picker model must exist in the gateway fixture");
}

test("approved examples are discovered, with one finding per model class and old Haiku stale", () => {
  const findings = report().findings;
  for (const model of ["claude-fable-5.1", "gpt-6-astra", "gemini-4-argon", "kimi-k3.1-pro", "qwen3.8-plus"]) {
    assert.ok(findings.some((finding) => finding.model.endsWith(`/${model}`)), model);
  }
  assert.equal(findings.find((finding) => finding.model === "claude-haiku-4.5").kind, "stale");
  assert.equal(findings.find((finding) => finding.model.endsWith("/qwen3.8-plus")).modelClass, "qwen-plus");
  assert.equal(findings.find((finding) => finding.model.endsWith("/claude-sonnet-5.6")).action, "ship automatically");
  assert.equal(findings.find((finding) => finding.model.endsWith("/gpt-6.2-sol")).action, "waits for HTPR-7746");
  assert.equal(findings.find((finding) => finding.model.endsWith("/gpt-6-astra")).action, "ask Valentin before shipping");
  assert.equal(findings.filter((finding) => finding.model.includes("claude-sonnet")).length, 1);
  assert.ok(!findings.some((finding) => finding.model.includes("image")));
});

test("picker membership assertion rejects a missing gateway model (positive and negative controls)", () => {
  assertPickerModelsListed(fixture);
  const missing = structuredClone(fixture);
  missing.gateway.data = missing.gateway.data.filter((model) => model.id !== "openai/gpt-6-luna");
  assert.throws(() => assertPickerModelsListed(missing), /Every picker model/);
});

test("gateway failure falls back to authenticated provider lists without claiming other providers are stale", async () => {
  const calls = [];
  const sources = await collectSources({ env: { OPENAI_API_KEY: "fixture-openai", ANTHROPIC_API_KEY: "fixture-anthropic" },
    fetchImpl: async (url, options) => {
      calls.push([url, options.headers]);
      if (url === "https://ai-gateway.vercel.sh/v1/models") return response({}, 403);
      if (url === "https://api.openai.com/v1/models") return response(fixture.openai);
      if (url === "https://api.anthropic.com/v1/models") return response(fixture.anthropic);
      throw new Error(`Unexpected model endpoint: ${url}`);
    } });
  const fallback = diffModels(catalog, sources);
  assert.deepEqual(fallback.sourcesUsed, ["openai", "anthropic"]);
  assert.ok(fallback.warnings.includes("gateway: HTTP 403"));
  assert.ok(fallback.findings.some((finding) => finding.model.includes("sonnet") && finding.action.includes("only after gateway pricing")));
  assert.equal(fallback.findings.filter((finding) => finding.kind === "stale").length, 1);
  assert.equal(calls.find(([url]) => url === "https://api.openai.com/v1/models")[1].Authorization, "Bearer fixture-openai");
  assert.equal(calls.find(([url]) => url === "https://api.anthropic.com/v1/models")[1]["x-api-key"], "fixture-anthropic");
});

test("provider pagination is complete, and absent keys or malformed gateway data are explicit", async () => {
  let pages = 0;
  const sources = await collectSources({ env: { ANTHROPIC_API_KEY: "fixture" }, fetchImpl: async (url) => {
    if (url.includes("ai-gateway")) return response({ html: "bot check" });
    pages++;
    return response(pages === 1 ? { data: [{ id: "claude-haiku-5-5" }], has_more: true, last_id: "claude-haiku-5-5" }
      : { data: [{ id: "claude-sonnet-5-6" }], has_more: false });
  } });
  assert.equal(pages, 2);
  assert.equal(sources.anthropic.data.length, 2);
  assert.equal(sources.openai.error, "no API key configured");
  assert.equal(sources.gateway.error, "invalid or empty model list");
});

test("premium is strictly over $5/M; unknown prices never permit an unconditional automatic shipment", () => {
  for (const [input, expected] of [["0.000005", "ship automatically"], ["0.00000501", "waits for HTPR-7746"],
    [undefined, "ship automatically only after gateway pricing confirms at most $5 per million input tokens"],
    ["not-a-price", "ship automatically only after gateway pricing confirms at most $5 per million input tokens"],
    [" ", "ship automatically only after gateway pricing confirms at most $5 per million input tokens"],
    [false, "ship automatically only after gateway pricing confirms at most $5 per million input tokens"]]) {
    const sources = structuredClone(fixture);
    sources.gateway.data.find((row) => row.id === "anthropic/claude-sonnet-5.6").pricing.input = input;
    assert.equal(diffModels(catalog, sources).findings.find((finding) => finding.model.endsWith("/claude-sonnet-5.6")).action, expected);
  }
  assert.deepEqual(identity("anthropic/claude-sonnet-5-6-20261024"), identity("claude-sonnet-5.6"));
  assert.throws(() => readCatalog("export const aiModelDefinitions = [];"), /Cannot read/);
});

test("CLI text and JSON use the same saved fixture and do not access the network", () => {
  const args = ["scripts/model-diff", "--fixture", "tests/fixtures/model-diff.json"];
  const json = spawnSync(process.execPath, [...args, "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), report());
  const text = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Sources used: gateway, openai, anthropic/);
  assert.match(text.stdout, /stale: claude-haiku-4.5/);
  assert.match(text.stdout, /waits for HTPR-7746/);
});

test("watcher creates one board-15 ticket, then deduplicates by stable title even when pricing changes", async () => {
  const finding = report().findings.find((item) => item.action === "ship automatically");
  const requests = [];
  let existing = [];
  const fetchImpl = async (url, options) => {
    requests.push([url, options]);
    if (options.method === "GET") return response({ success: true, tasks: existing, total: existing.length });
    const body = JSON.parse(options.body);
    assert.equal(body.project_id, 15);
    assert.equal(body.section_id, 4389);
    assert.match(body.description, /ship automatically/);
    assert.ok(options.headers["Idempotency-Key"].startsWith("modelwatch"));
    existing = [{ title: body.title, ticketNumber: "HTPR-fixture" }];
    return response({ success: true, task: existing[0] });
  };
  const first = await fileFindings({ sourcesUsed: ["gateway"], findings: [finding] }, { token: "fixture", fetchImpl });
  const second = await fileFindings({ sourcesUsed: ["gateway"], findings: [{ ...finding, inputPerMillion: 4 }] }, { token: "fixture", fetchImpl });
  assert.equal(first[0].action, "created");
  assert.equal(second[0].action, "exists");
  assert.equal(requests.filter(([, options]) => options.method === "POST").length, 1);
  assert.ok(requests[0][0].includes("status=open"));
  assert.equal(ticketFor(finding).title, ticketFor({ ...finding, action: "changed", current: [], model: "claude-sonnet-5-6-20261024" }).title);
});

test("watcher refuses writes on failed, partial, malformed or truncated searches, and with no discovery sources", async () => {
  for (const page of [response({}, 500), response({ success: false }), response({ success: true }),
    response({ success: true, tasks: [], total: 1 }), response({ success: true, tasks: [], total: 0, partial: true }),
    response({ success: true, tasks: [], total: 0, nextCursor: "123" })]) {
    let writes = 0;
    await assert.rejects(fileFindings(report(), { token: "fixture", fetchImpl: async (_url, options) => {
      if (options.method === "POST") writes++;
      return page;
    } }));
    assert.equal(writes, 0);
  }
  await assert.rejects(fileFindings({ sourcesUsed: [], findings: [] }, { token: "fixture" }), /No usable/);
  const ticket = ticketFor({ ...report().findings[0], reason: "<untrusted>" });
  assert.ok(ticket.description.includes("&lt;untrusted&gt;"));
  assert.ok(!ticket.description.includes("<untrusted>"));
});

test("workflow and CI policy agree on trusted production-only hosted daily execution", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ai-model-watch.yml"), "utf8");
  const policy = fs.readFileSync(path.join(root, "docs/ci-policy.yml"), "utf8");
  assert.match(workflow, /cron: '43 5 \* \* \*'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/production'/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /timeout-minutes: 10/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node --test tests\/model-diff.test.cjs/);
  assert.match(policy, /ai_model_watch:\n[\s\S]*cron_utc: "43 5 \* \* \*"/);
});
