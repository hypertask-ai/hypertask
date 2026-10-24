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
  for (const id of ["openai/gpt-6-luna", "deepseek/deepseek-v4.1-flash-1017", "deepseek/deepseek-v4.1-flash-1017-fast"]) {
    const missing = structuredClone(fixture);
    missing.gateway.data = missing.gateway.data.filter((model) => model.id !== id);
    assert.throws(() => assertPickerModelsListed(missing), /Every picker model/, id);
  }
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

test("watcher finds an exact title on the second page without creating", async () => {
  const finding = report().findings[0];
  const ticket = ticketFor(finding);
  const cursors = [];
  const results = await fileFindings({ sourcesUsed: ["gateway"], findings: [finding] }, { token: "fixture",
    fetchImpl: async (url, options) => {
      assert.equal(options.method, "GET", "An existing ticket must never be recreated");
      const query = new URL(url).searchParams;
      assert.equal(query.get("q"), ticket.marker);
      assert.equal(query.get("project_id"), "15");
      assert.equal(query.get("status"), "open");
      assert.equal(query.get("limit"), "50");
      cursors.push(query.get("cursor"));
      return response(cursors.length === 1
        ? { success: true, tasks: Array.from({ length: 50 }, () => ({ title: `Fuzzy match ${ticket.marker}` })), total: 83, nextCursor: "66709" }
        : { success: true, tasks: [{ title: ticket.title }], total: 83, nextCursor: "66710" });
    } });
  assert.deepEqual(cursors, [null, "66709"]);
  assert.deepEqual(results, [{ title: ticket.title, action: "exists" }]);
});

test("watcher exhausts pages before creating once with the stable marker idempotency key", async () => {
  const finding = report().findings[0];
  const ticket = ticketFor(finding);
  const calls = [];
  const results = await fileFindings({ sourcesUsed: ["gateway"], findings: [finding] }, { token: "fixture",
    fetchImpl: async (url, options) => {
      const cursor = new URL(url).searchParams.get("cursor");
      calls.push([options.method, cursor]);
      if (options.method === "GET") return response(cursor === null
        ? { success: true, tasks: Array.from({ length: 50 }, () => ({ title: `Fuzzy match ${ticket.marker}` })), total: 83, nextCursor: "66709" }
        : { success: true, tasks: Array.from({ length: 33 }, () => ({ title: "Another fuzzy match" })), total: 83, nextCursor: null });
      assert.equal(options.headers["Idempotency-Key"], ticket.marker);
      assert.equal(JSON.parse(options.body).title, ticket.title);
      return response({ success: true, task: { ticketNumber: "HTPR-fixture" } });
    } });
  assert.deepEqual(calls, [["GET", null], ["GET", "66709"], ["POST", null]]);
  assert.deepEqual(results, [{ title: ticket.title, action: "created", ticket: "HTPR-fixture" }]);
});

test("watcher CLI refuses incomplete or failing later pages with non-zero exit and the real error", () => {
  const directory = fs.mkdtempSync(path.join(root, ".model-watch-test-"));
  try {
    const reportPath = path.join(directory, "report.json");
    const stubPath = path.join(directory, "fetch.cjs");
    fs.writeFileSync(reportPath, JSON.stringify({ sourcesUsed: ["gateway"], findings: [report().findings[0]] }));
    for (const [page, status, message] of [
      [{ success: true, tasks: [{ title: "Other" }], total: 3, nextCursor: null }, 200, "Ticket search is incomplete"],
      [{}, 503, "Hypertask ticket API returned HTTP 503"],
      [{ success: true, tasks: [], total: 3, nextCursor: "66710" }, 200, "Ticket search is incomplete"],
      [{ success: true, tasks: [{ title: "Other" }], total: 2, nextCursor: null }, 200, "Ticket search is incomplete"],
      [{ success: true, tasks: [{ title: "Other" }], total: 3, nextCursor: 66710 }, 200, "Ticket search is incomplete"],
      [{ success: true, tasks: [{ title: "Other" }], total: 3, nextCursor: "66709" }, 200, "Ticket search is incomplete"],
      [{ success: true, tasks: [{ title: "Other" }], total: 3, nextCursor: null, partial: true }, 200, "Ticket search is incomplete"],
    ]) {
      fs.writeFileSync(stubPath, `
        let calls = 0;
        global.fetch = async (url, options) => {
          if (options.method !== "GET") {
            console.error("UNEXPECTED CREATE");
            throw new Error("Unexpected create");
          }
          const cursor = new URL(url).searchParams.get("cursor");
          if (calls++ > 1 || cursor !== (calls === 1 ? null : "66709")) throw new Error("Unexpected cursor");
          const body = calls === 1
            ? { success: true, tasks: [{ title: "Fuzzy match" }], total: 3, nextCursor: "66709" }
            : ${JSON.stringify(page)};
          const status = calls === 1 ? 200 : ${status};
          return { ok: status < 400, status, json: async () => body };
        };
      `);
      const result = spawnSync(process.execPath, ["--require", stubPath, ".github/scripts/ai-model-watch.cjs", reportPath],
        { cwd: root, encoding: "utf8", env: { ...process.env, HYPERTASK_MCP_TOKEN: "fixture" } });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stderr.trim(), `AI model ticket filing failed: ${message}${message.startsWith("Ticket search") ? "; refusing duplicate creation" : ""}`);
      assert.ok(!result.stderr.includes("UNEXPECTED CREATE"));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
