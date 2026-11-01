const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readCatalog, identity, collectSources, diffModels } = require("../scripts/model-diff");
const { ticketFor, rollupTicket, fileFindings } = require("../.github/scripts/ai-model-watch.cjs");
const fixture = require("./fixtures/model-diff.json");
const root = path.resolve(__dirname, "..");
const catalog = readCatalog(fs.readFileSync(path.join(root, "src/lib/aiModelOptions.ts"), "utf8"));
const report = () => diffModels(catalog, structuredClone(fixture));
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

const twoVersionCatalog = {
  definitions: [
    { key: "claude-haiku-4.5", modelClass: "claude-haiku", label: "Haiku 4.5", provider: "anthropic", priceTier: 1 },
    { key: "claude-haiku-5-5", modelClass: "claude-haiku", label: "Haiku 5.5", provider: "anthropic", priceTier: 1 },
  ],
  options: [
    { id: "claude-haiku-4.5", modelKey: "claude-haiku-4.5", model: "claude-haiku-4.5", source: "claude" },
    { id: "claude-haiku-5-5", modelKey: "claude-haiku-5-5", model: "claude-haiku-5.5", source: "claude" },
  ],
};
const staleFinding = () => diffModels(twoVersionCatalog, structuredClone(fixture)).findings.find((finding) => finding.kind === "stale");
const findingOfKind = (kind) => kind === "stale" ? staleFinding() : report().findings.find((item) => item.kind === kind);

function assertPickerModelsListed(sources) {
  const missing = diffModels(catalog, sources).findings.filter((finding) => finding.reason === "picker model missing from gateway list");
  assert.deepEqual(missing, [], "Every picker model must exist in the gateway fixture");
}

test("approved examples are discovered, with one finding per model class and no stale Haiku left", () => {
  const findings = report().findings;
  for (const model of ["claude-fable-5.1", "gpt-6-astra", "kimi-k3.1-pro", "qwen3.8-plus"]) {
    assert.ok(findings.some((finding) => finding.model.endsWith(`/${model}`)), model);
  }
  assert.equal(findings.filter((finding) => finding.kind === "stale").length, 0);
  assert.equal(findings.some((finding) => finding.model === "claude-haiku-4.5"), false);
  assert.equal(findings.find((finding) => finding.model.endsWith("/qwen3.8-plus")).modelClass, "qwen-plus");
  assert.equal(findings.find((finding) => finding.model.endsWith("/claude-sonnet-5.6")).action, "ship automatically");
  assert.equal(findings.find((finding) => finding.model.endsWith("/gpt-6.2-sol")).action, "waits for HTPR-7746");
  assert.equal(findings.find((finding) => finding.model.endsWith("/gpt-6-astra")).action, "ask Valentin before shipping");
  assert.equal(findings.filter((finding) => finding.model.includes("claude-sonnet")).length, 1);
  assert.ok(!findings.some((finding) => finding.model.includes("image")));
  assert.ok(!findings.some((finding) => /gemini-4-argon|grok-4\.7/.test(finding.model)));
});

test("stale detection still fires for a catalogue that keeps two versions of one class", () => {
  const stale = staleFinding();
  assert.equal(stale.model, "claude-haiku-4.5");
  assert.deepEqual(stale.current, ["claude-haiku-5-5"]);
  assert.equal(stale.reason, "superseded by claude-haiku-5-5");
  assert.equal(stale.action, "remove stale entry; migrate saved picks to the current model of its class");
});

test("serving variants share their base model family without changing name or version", () => {
  for (const [variant, base] of [
    ["openai/gpt-4o-batch", "openai/gpt-4o"],
    ["anthropic/claude-opus-5.5-fast", "anthropic/claude-opus-5.5"],
    ["spacexai/grok-4.20-reasoning-beta", "spacexai/grok-4.20-reasoning"],
    ["spacexai/grok-4.20-reasoning", "spacexai/grok-4.20"],
  ]) {
    assert.equal(identity(variant).family, identity(base).family, variant);
    assert.deepEqual(identity(variant).version, identity(base).version, variant);
  }
  assert.equal(identity("openai/gpt-4o-batch").name, "gpt-4o-batch");
  assert.deepEqual(identity("openai/gpt-4o-batch").version, [4]);
  assert.equal(identity("anthropic/claude-opus-5.5-fast").name, "claude-opus-5.5-fast");
  assert.deepEqual(identity("anthropic/claude-opus-5.5-fast").version, [5, 5]);
});

test("only trailing serving tokens are stripped repeatedly without emptying the model family", () => {
  for (const suffix of ["batch", "fast", "preview", "beta", "experimental", "latest", "online", "reasoning", "non-reasoning", "thinking"]) {
    assert.equal(identity(`openai/gpt-4o-${suffix}`).family, identity("openai/gpt-4o").family, suffix);
    assert.equal(identity(`openai/gpt-${suffix}-4o-mini`).family, `gpt-${suffix}-o-mini`, suffix);
  }
  assert.equal(identity("openai/gpt-4o-batch-fast").family, identity("openai/gpt-4o").family);
  assert.equal(identity("openai/batch-fast").family, "batch");
  assert.equal(identity("openai/-batch").family, "-batch");
  assert.notEqual(identity("openai/gpt-4o-mini").family, identity("openai/gpt-4o").family);
  assert.notEqual(identity("openai/o3").family, identity("openai/gpt-4o").family);
  assert.notEqual(identity("openai/gpt-4obatch").family, identity("openai/gpt-4o").family);
});

test("saved gateway fixture groups offered serving variants without new classes or duplicate family findings", () => {
  const offered = structuredClone(catalog);
  offered.definitions.push({ key: "gpt-4o", provider: "openai", modelClass: "gpt-o" });
  offered.options.push({ modelKey: "gpt-4o", model: "gpt-4o" });
  for (const ids of [["openai/gpt-4o", "openai/gpt-4o-batch"], ["openai/gpt-4o-batch", "openai/gpt-4o"]]) {
    const sources = structuredClone(fixture);
    sources.gateway.data.push(...ids.map((id) => ({ id, type: "language" })));
    const findings = diffModels(offered, sources).findings;
    assert.deepEqual(findings.filter((finding) => identity(finding.model).family === identity("openai/gpt-4o").family), []);
    const families = findings.map((finding) => `${finding.provider}/${identity(finding.model).family}`);
    assert.equal(new Set(families).size, findings.length);
  }
});

test("a newer serving variant follows the existing new-version path once per family", () => {
  const sources = structuredClone(fixture);
  sources.gateway.data.push({ id: "anthropic/claude-opus-5.6-fast", type: "language" },
    { id: "anthropic/claude-opus-5.6-reasoning-beta", type: "language" });
  const findings = diffModels(catalog, sources).findings.filter((finding) =>
    identity(finding.model).family === identity("anthropic/claude-opus-5.5").family);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "new-version");
  assert.equal(findings[0].model, "anthropic/claude-opus-5.6-fast");
  assert.equal(findings[0].modelClass, "claude-opus");
  assert.deepEqual(findings[0].current, ["claude-opus-5-5"]);
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
  assert.equal(fallback.findings.filter((finding) => finding.kind === "stale").length, 0);
  const stale = diffModels(twoVersionCatalog, sources).findings.filter((finding) => finding.kind === "stale");
  assert.deepEqual(stale.map((finding) => finding.model), ["claude-haiku-4.5"]);
  assert.equal(stale[0].action, "remove stale entry; migrate saved picks to the current model of its class");
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
  assert.doesNotMatch(text.stdout, /stale: /);
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
  assert.equal(requests.filter(([, options]) => options.method === "GET").length, 2);
  assert.ok(requests[0][0].includes("status=open"));
  assert.equal(ticketFor(finding).title, ticketFor({ ...finding, action: "changed", current: [], model: "claude-sonnet-5-6-20261024" }).title);
});

test("rollup uses the exact UTC-day marker, lists prices and actions, and escapes HTML", () => {
  const findings = [
    { kind: "new-class", provider: "new<provider>", model: "new<provider>/model-1", inputPerMillion: 0, action: "ask <Valentin> & verify" },
    { kind: "new-class", provider: "other", model: "other/model-2", inputPerMillion: null, action: "waits for HTPR-7746" },
    { kind: "new-class", provider: "unknown", model: "unknown/model-3", action: "ask Valentin before shipping" },
  ];
  const ticket = rollupTicket(findings, new Date("2026-10-24T23:30:00-02:00"));
  assert.equal(ticket.marker, "modelwatchrollup-2026-10-25");
  assert.equal(ticket.title, "AI model watch new classes [modelwatchrollup-2026-10-25]");
  assert.ok(ticket.description.startsWith("<p><strong>3 new model classes are not in our catalog.</strong></p><ul>"));
  assert.equal((ticket.description.match(/<li>/g) || []).length, 3);
  assert.match(ticket.description, /<code>new&lt;provider&gt;\/model-1<\/code>\. Gateway input price per million tokens: \$0\. ask &lt;Valentin&gt; &amp; verify\.<\/li>/);
  assert.equal((ticket.description.match(/unknown; verify pricing before shipping/g) || []).length, 2);
  assert.match(ticket.description, /<code>other\/model-2<\/code>.*waits for HTPR-7746\.<\/li>/);
  assert.match(ticket.description, /<code>unknown\/model-3<\/code>.*ask Valentin before shipping\.<\/li>/);
  assert.ok(!ticket.description.includes("<provider>"));
  assert.ok(!ticket.description.includes("<Valentin>"));
  const guidance = ticketFor(report().findings[0]).description.split("<p>Follow ")[1];
  assert.ok(ticket.description.endsWith(`<p>Follow ${guidance}`));
});

test("watcher creates one rollup for three new classes and one separate new-version ticket", async () => {
  const newClasses = report().findings.filter((finding) => finding.kind === "new-class").slice(0, 3);
  assert.equal(newClasses.length, 3);
  const version = report().findings.find((finding) => finding.kind === "new-version");
  const now = new Date("2026-10-25T12:00:00Z");
  const rollup = rollupTicket(newClasses, now);
  const perModel = ticketFor(version);
  const searches = [];
  const creates = [];
  const results = await fileFindings({ sourcesUsed: ["gateway"], findings: [newClasses[0], version, ...newClasses.slice(1)] },
    { token: "fixture", now, fetchImpl: async (url, options) => {
      if (options.method === "GET") {
        searches.push(new URL(url).searchParams.get("q"));
        return response({ success: true, tasks: [], total: 0 });
      }
      const body = JSON.parse(options.body);
      creates.push(body);
      assert.equal(url, "https://app.hypertask.ai/api/mcp/tasks/create");
      assert.equal(body.project_id, 15);
      assert.equal(body.section_id, 4389);
      assert.equal(body.content_type, "html");
      assert.equal(options.headers["Idempotency-Key"], body.title === rollup.title ? rollup.marker : perModel.marker);
      return response({ success: true, task: { ticketNumber: `HTPR-fixture-${creates.length}` } });
    } });
  assert.deepEqual(searches, [rollup.marker, perModel.marker]);
  assert.equal(creates.length, 2);
  assert.deepEqual(creates.map(({ title, description }) => ({ title, description })),
    [rollup, perModel].map(({ title, description }) => ({ title, description })));
  const rollupDescription = creates.find((ticket) => ticket.title === rollup.title).description;
  assert.equal((rollupDescription.match(/<li>/g) || []).length, 3);
  for (const finding of newClasses) {
    assert.ok(rollupDescription.includes(`${finding.provider}/${identity(finding.model).name}`));
    assert.ok(rollupDescription.includes(`Gateway input price per million tokens: $${finding.inputPerMillion}`));
    assert.ok(rollupDescription.includes(finding.action));
  }
  assert.deepEqual(results, [
    { title: rollup.title, action: "created", ticket: "HTPR-fixture-1" },
    { title: perModel.title, action: "created", ticket: "HTPR-fixture-2" },
  ]);
});

test("watcher creates a rollup once per UTC day even when the findings change", async () => {
  const findings = report().findings.filter((finding) => finding.kind === "new-class").slice(0, 3);
  const existing = [];
  const markers = [];
  let creates = 0;
  const fetchImpl = async (url, options) => {
    if (options.method === "GET") {
      markers.push(new URL(url).searchParams.get("q"));
      return response({ success: true, tasks: existing, total: existing.length });
    }
    creates++;
    const ticket = { title: JSON.parse(options.body).title, ticketNumber: "HTPR-fixture" };
    existing.push(ticket);
    return response({ success: true, task: ticket });
  };
  const first = await fileFindings({ sourcesUsed: ["gateway"], findings },
    { token: "fixture", fetchImpl, now: new Date("2026-10-24T23:30:00-02:00") });
  const second = await fileFindings({ sourcesUsed: ["gateway"], findings: findings.slice(0, 2) },
    { token: "fixture", fetchImpl, now: new Date("2026-10-26T00:30:00+02:00") });
  assert.equal(creates, 1);
  assert.deepEqual(markers, ["modelwatchrollup-2026-10-25", "modelwatchrollup-2026-10-25"]);
  assert.deepEqual(first, [{ title: existing[0].title, action: "created", ticket: "HTPR-fixture" }]);
  assert.deepEqual(second, [{ title: existing[0].title, action: "exists" }]);
});

test("watcher creates a new rollup on the next UTC date", async () => {
  const findings = report().findings.filter((finding) => finding.kind === "new-class").slice(0, 3);
  const existing = [];
  const markers = [];
  const fetchImpl = async (url, options) => {
    if (options.method === "GET") {
      const marker = new URL(url).searchParams.get("q");
      const tasks = existing.filter((ticket) => ticket.title.includes(`[${marker}]`));
      return response({ success: true, tasks, total: tasks.length });
    }
    markers.push(options.headers["Idempotency-Key"]);
    const ticket = { title: JSON.parse(options.body).title, ticketNumber: `HTPR-fixture-${existing.length + 1}` };
    existing.push(ticket);
    return response({ success: true, task: ticket });
  };
  const results = [];
  for (const date of ["2026-10-25T23:59:59Z", "2026-10-26T00:00:00Z"]) {
    results.push(...await fileFindings({ sourcesUsed: ["gateway"], findings }, { token: "fixture", fetchImpl, now: new Date(date) }));
  }
  assert.equal(existing.length, 2);
  assert.deepEqual(markers, ["modelwatchrollup-2026-10-25", "modelwatchrollup-2026-10-26"]);
  assert.deepEqual(results, existing.map((ticket) => ({ title: ticket.title, action: "created", ticket: ticket.ticketNumber })));
  assert.notEqual(existing[0].title, existing[1].title);
});

test("watcher does not search or create an empty rollup", async () => {
  const results = await fileFindings({ sourcesUsed: ["gateway"], findings: [] }, { token: "fixture",
    fetchImpl: async () => { throw new Error("Unexpected ticket API call"); } });
  assert.deepEqual(results, []);
});

for (const kind of ["new-class", "new-version", "stale"]) {
  test(`watcher finds an exact ${kind} title on the second page without creating`, async () => {
    const finding = findingOfKind(kind);
    const now = new Date("2026-10-25T12:00:00Z");
    const ticket = kind === "new-class" ? rollupTicket([finding], now) : ticketFor(finding);
    const cursors = [];
    const results = await fileFindings({ sourcesUsed: ["gateway"], findings: [finding] }, { token: "fixture", now,
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

  test(`watcher exhausts ${kind} pages before creating once with the stable marker idempotency key`, async () => {
    const finding = findingOfKind(kind);
    const now = new Date("2026-10-25T12:00:00Z");
    const ticket = kind === "new-class" ? rollupTicket([finding], now) : ticketFor(finding);
    const calls = [];
    const results = await fileFindings({ sourcesUsed: ["gateway"], findings: [finding] }, { token: "fixture", now,
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
}

test("watcher CLI refuses incomplete or failing later pages with non-zero exit and the real error", () => {
  const directory = fs.mkdtempSync(path.join(root, ".model-watch-test-"));
  try {
    const reportPath = path.join(directory, "report.json");
    const stubPath = path.join(directory, "fetch.cjs");
    fs.writeFileSync(reportPath, JSON.stringify({ sourcesUsed: ["gateway"], findings: [report().findings.find((finding) => finding.kind === "new-class")] }));
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
  for (const kind of ["new-class", "new-version", "stale"]) {
    const finding = findingOfKind(kind);
    for (const page of [response({}, 500), response({ success: false }), response({ success: true }),
      response({ success: true, tasks: [], total: 1 }), response({ success: true, tasks: [], total: 0, partial: true }),
      response({ success: true, tasks: [], total: 0, nextCursor: "123" })]) {
      let writes = 0;
      await assert.rejects(fileFindings({ sourcesUsed: ["gateway"], findings: [finding] }, { token: "fixture", fetchImpl: async (_url, options) => {
        if (options.method === "POST") writes++;
        return page;
      } }));
      assert.equal(writes, 0);
    }
  }
  await assert.rejects(fileFindings({ sourcesUsed: [], findings: [] }, { token: "fixture" }), /No usable/);
  const ticket = ticketFor({ ...report().findings[0], reason: "<untrusted>" });
  assert.ok(ticket.description.includes("&lt;untrusted&gt;"));
  assert.ok(!ticket.description.includes("<untrusted>"));
});
