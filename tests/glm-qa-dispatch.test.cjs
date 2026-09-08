// HTPR-6239 — focused checks for the GLM post-deploy QA dispatch: the script's
// pure helpers (ticket parsing, screen mapping, brief construction, escaping)
// exercised via import of the .mjs module, plus source-level guards that the
// workflow's glm-qa job stays exploratory (gated on smoke, never rolls back).

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
  // Token boundaries: lookalikes and glued text must never match.
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
  // Prefixes are path-segment matches: a lookalike inside another word never
  // maps to a screen and falls back to its top-level area instead.
  assert.deepEqual(mapScreens("src/lib/browser-search-helper.ts"), ["the src area"]);
  assert.deepEqual(mapScreens("src/lib/graphql-api/foo.ts"), ["the src area"]);
  assert.deepEqual(mapScreens("src/app/notdetail/page.tsx"), ["the src area"]);
  // Capped at 3.
  const six = mapScreens(
    "src/app/inbox/x.tsx src/app/calendar/x.tsx src/app/search/x.tsx src/app/settings/x.tsx src/app/new/x.tsx",
  );
  assert.equal(six.length, 3);
  // Fallback names the unmatched top-level areas instead of nothing.
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

  // The mention span the server-side agent extraction matches on.
  assert.match(text, /data-label="agent-1e03aa38-86b6-47fe-acb3-ff14344d8978"/);
  // Everything dynamic is escaped.
  assert.match(text, /&quot;GLM&quot; &lt;pass&gt; &amp; friends/);
  assert.doesNotMatch(text, /<pass>/);
  // The duplicate-run marker and the smoke context are present.
  assert.match(text, new RegExp(`glm-qa-brief:${"a".repeat(40)}`));
  assert.match(text, /smoke check passed/);
  // The agent is ordered to report and never to touch deploy state.
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

  // An absent smoke verdict must read as unknown, never as a pass.
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
});

test("the glm-qa job is exploratory: gated on smoke, wired to the dispatcher, and free of rollback behavior", async () => {
  const workflow = await readFile(WORKFLOW, "utf8");
  const start = workflow.indexOf("  glm-qa:");
  assert.notEqual(start, -1, "glm-qa job missing from prod-health.yml");
  const end = workflow.indexOf("\n  drift:", start);
  const job = workflow.slice(start, end);

  // Runs only for real deploys whose smoke checks actually executed and that
  // were not rolled back.
  assert.match(job, /needs: \[health, smoke\]/);
  assert.match(job, /needs\.smoke\.outputs\.ran == 'true'/);
  assert.match(job, /needs\.smoke\.outputs\.rolledback != 'true'/);
  assert.match(job, /github\.event_name == 'push'/);
  // Dispatches the committed script and alerts without failing the deploy.
  assert.match(job, /dispatch-glm-qa\.mjs/);
  assert.match(job, /continue-on-error: true/);
  // Exploratory: no rollback, no promote, no Vercel write in this job.
  assert.doesNotMatch(job, /emergency-rollback|\/promote\/|api\.vercel\.com/);
});

test("smoke exposes ran/ok/rolledback outputs for the glm-qa gate", async () => {
  const workflow = await readFile(WORKFLOW, "utf8");
  const smokeStart = workflow.indexOf("  smoke:");
  const smokeEnd = workflow.indexOf("\n  glm-qa:", smokeStart);
  const smoke = workflow.slice(smokeStart, smokeEnd);
  assert.match(smoke, /ran: \$\{\{ steps\.smoke\.outcome != 'skipped'/);
  assert.match(smoke, /ok: \$\{\{ steps\.smoke\.outcome == 'success' \}\}/);
  assert.match(smoke, /rolledback: \$\{\{ steps\.decide\.outputs\.rolledback == 'true' \}\}/);
  // The rollback branch records the verdict the gate reads.
  assert.match(smoke, /echo "rolledback=true" >> "\$GITHUB_OUTPUT"/);
});
