const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const SCRIPT = path.join(process.cwd(), ".github/scripts/dispatch-glm-qa.mjs");
const WORKFLOW = path.join(process.cwd(), ".github/workflows/prod-health.yml");

test("the pull request title yields the deploy ticket number", async () => {
  const { parseTicketNumber } = await import(SCRIPT);
  assert.equal(
    parseTicketNumber("HTPR-6197 [BUGFIX] Head the proposal card once the ticket exists (#400)"),
    6197,
  );
  assert.equal(parseTicketNumber("Revert \"accidental push\" (#401)"), null);
  assert.equal(parseTicketNumber("XHTPR-123 fix the thing"), null);
  assert.equal(parseTicketNumber("HTPR-123abc fix the thing"), null);
  assert.equal(parseTicketNumber(""), null);
});

test("changed files map to at most 3 known screens and never to lookalike names", async () => {
  const { mapScreens } = await import(SCRIPT);
  assert.deepEqual(
    mapScreens("src/app/inbox/page.tsx src/app/inbox/InboxList.tsx src/components/search/SearchBar.tsx"),
    ["inbox", "AI search"],
  );
  assert.deepEqual(mapScreens("src/lib/browser-search-helper.ts"), ["the src area"]);
  assert.deepEqual(mapScreens("src/lib/graphql-api/foo.ts"), ["the src area"]);
  assert.deepEqual(mapScreens("src/app/notdetail/page.tsx"), ["the src area"]);
  const six = mapScreens(
    "src/app/inbox/x.tsx src/app/calendar/x.tsx src/app/search/x.tsx src/app/settings/x.tsx src/app/new/x.tsx",
  );
  assert.equal(six.length, 3);
  assert.deepEqual(mapScreens("packages/shared/x.ts scripts/tool.mjs"), [
    "the packages area",
    "the scripts area",
  ]);
  assert.deepEqual(mapScreens(""), []);
});

test("the brief names the agent, the screens, the marker, and the read-only rules", async () => {
  const { buildBriefText } = await import(SCRIPT);
  const text = buildBriefText({
    sha: "a".repeat(40),
    prTitle: 'HTPR-6239 [FEATURE] Ship the "GLM" <pass> & friends (#402)',
    screens: ["inbox", "AI search"],
    smokeOk: true,
    agentName: "GLM Dev 3",
    agentId: "1e03aa38-86b6-47fe-acb3-ff14344d8978",
  });

  assert.match(text, /data-label="agent-1e03aa38-86b6-47fe-acb3-ff14344d8978"/);
  assert.match(text, /&quot;GLM&quot; &lt;pass&gt; &amp; friends/);
  assert.doesNotMatch(text, /<pass>/);
  assert.match(text, new RegExp(`glm-qa-brief:${"a".repeat(40)}`));
  assert.match(text, /smoke check passed/);
  assert.match(text, /never roll back/i);
  assert.match(text, /never submit forms/i);

  const failed = buildBriefText({
    sha: "b".repeat(40),
    prTitle: "HTPR-1 x",
    screens: ["inbox"],
    smokeOk: false,
    agentName: "GLM Dev 3",
    agentId: "1e03aa38-86b6-47fe-acb3-ff14344d8978",
  });
  assert.match(failed, /smoke check failed without a confirmed break/);

  const unknown = buildBriefText({
    sha: "c".repeat(40),
    prTitle: "HTPR-1 x",
    screens: ["inbox"],
    smokeOk: null,
    agentName: "GLM Dev 3",
    agentId: "1e03aa38-86b6-47fe-acb3-ff14344d8978",
  });
  assert.match(unknown, /no clear verdict/);
  assert.doesNotMatch(unknown, /smoke check passed/);

  const any = buildBriefText({
    sha: "d".repeat(40),
    prTitle: "HTPR-1 x",
    screens: ["inbox"],
    agentName: "GLM Dev 3",
    agentId: "1e03aa38-86b6-47fe-acb3-ff14344d8978",
  });
  assert.match(any, /\/api\/version must return buildId/);
  assert.match(any, /stale and stop/);
});

test("the liveness probe retries transient failures, then fails closed", async () => {
  const { fetchLiveBuildId } = await import(SCRIPT);
  const realFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls <= 2) throw new Error("boom");
      return { ok: true, json: async () => ({ buildId: "build-1" }) };
    };
    assert.equal(await fetchLiveBuildId("https://base", { attempts: 3, delayMs: 1 }), "build-1");
    assert.equal(calls, 3);

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("down");
    };
    await assert.rejects(
      () => fetchLiveBuildId("https://base", { attempts: 2, delayMs: 1 }),
      /down/,
    );
    assert.equal(calls, 2);

    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    assert.equal(await fetchLiveBuildId("https://base", { attempts: 1 }), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the glm-qa job is exploratory: gated on smoke, wired to the dispatcher, and free of rollback behavior", async () => {
  const workflow = await readFile(WORKFLOW, "utf8");
  const start = workflow.indexOf("  glm-qa:");
  assert.notEqual(start, -1, "glm-qa job missing from prod-health.yml");
  const end = workflow.indexOf("\n  drift:", start);
  const job = workflow.slice(start, end);

  assert.match(job, /needs: \[health, smoke\]/);
  assert.match(job, /needs\.health\.outputs\.live == 'true'/);
  assert.doesNotMatch(job, /needs\.smoke\.outputs\.ran == 'true'/);
  assert.match(job, /needs\.smoke\.outputs\.rollback != 'true'/);
  assert.match(job, /github\.event_name == 'push'/);
  assert.match(job, /dispatch-glm-qa\.mjs/);
  assert.match(job, /continue-on-error: true/);
  assert.match(job, /--smoke-unknown/);
  assert.match(
    job,
    /\[ "\$\{\{ needs\.smoke\.outputs\.ran \}\}" = "true" \].*--smoke-ok \$\{\{ needs\.smoke\.outputs\.ok \}\}/s,
  );
  assert.doesNotMatch(job, /emergency-rollback|\/promote\/|api\.vercel\.com/);
});

test("smoke exposes ran/ok and confirmed rollback outputs for exploratory QA", async () => {
  const workflow = await readFile(WORKFLOW, "utf8");
  const smokeStart = workflow.indexOf("  smoke:");
  const smokeEnd = workflow.indexOf("\n  glm-qa:", smokeStart);
  const smoke = workflow.slice(smokeStart, smokeEnd);
  const expression = smoke.match(/ran: \$\{\{ (.*?) \}\}/)[1];
  const vm = require("node:vm");
  for (const [outcome, confirmed, expected] of [
    ["success", "", true], ["failure", "true", true],
    ["failure", "", false], ["skipped", "", false], ["cancelled", "", false],
  ]) {
    assert.equal(vm.runInNewContext(expression, {
      steps: { smoke: { outcome }, decide: { outputs: { confirmed } } },
    }), expected, `${outcome}, confirmed=${confirmed}`);
  }
  assert.match(smoke, /ok: \$\{\{ steps\.smoke\.outcome == 'success' \}\}/);
  assert.match(smoke, /rollback: \$\{\{ steps\.alarm\.outputs\.rollback \}\}/);
});
