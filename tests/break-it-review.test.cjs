const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const load = () => import(path.join(root, ".github/scripts/break-it-review.mjs"));

const good = "const assert = require(\"node:assert/strict\");\nconst test = require(\"node:test\");\nconst { loadModule } = require(\"../helpers/loadModule.cjs\");\ntest(\"adds\", () => { assert.equal(loadModule(\"src/lib/flags/index.ts\") ? 2 : 2, 2); });\n";

test("the break prompt carries the diff, the author family and the ticket, never the key", async () => {
  const { breakPrompt } = await load();
  process.env.OPENROUTER_EVAL_KEY = "sk-test-break-it-secret";
  const prompt = breakPrompt({ author: "deepseek", ticket: "https://app.hypertask.ai/detail/project-15/9408", diff: "- old line\n+ new line", files: ["src/app/page.tsx"] });
  delete process.env.OPENROUTER_EVAL_KEY;
  assert.match(prompt, /author model family is deepseek/);
  assert.match(prompt, /\+ new line/);
  assert.match(prompt, /https:\/\/app\.hypertask\.ai\/detail\/project-15\/9408/);
  assert.match(prompt, /src\/app\/page\.tsx/);
  assert.equal(prompt.includes("sk-test-break-it-secret"), false);
  assert.match(prompt, /at most 3 tests/);
});

test("the parser accepts one honest test and refuses the ways a model answer goes wrong", async () => {
  const { parseBreakTests } = await load();
  const parsed = parseBreakTests(JSON.stringify({ tests: [{ name: "Empty Title", code: good }] }));
  assert.deepEqual(parsed.map((item) => item.file), ["break-it-empty-title.test.cjs"]);
  assert.throws(() => parseBreakTests(JSON.stringify({ tests: [{ name: "a", code: good }, { name: "b", code: good }, { name: "c", code: good }, { name: "d", code: good }] })), /no usable tests/);
  assert.throws(() => parseBreakTests(JSON.stringify({ tests: [{ name: "a", code: good.replace('require("node:test")', 'require("node:assert")') }] })), /does not use node:test/);
  assert.throws(() => parseBreakTests(JSON.stringify({ tests: [{ name: "a", code: `${good}\nrequire("node:child_process").execSync("id");` }] })), /forbidden call/);
  assert.throws(() => parseBreakTests(JSON.stringify({ tests: [{ name: "a", code: "tiny" }] })), /wrong size/);
  assert.throws(() => parseBreakTests("not json at all"), /was not JSON/);
});

test("broken attempts are named as broken and passing attempts as held", async () => {
  const { breakSummary } = await load();
  const tests = [{ name: "one", file: "break-it-one.test.cjs" }, { name: "two", file: "break-it-two.test.cjs" }];
  const broke = breakSummary({ author: "claude", model: "deepseek/deepseek-v4.1-flash", tests, results: [{ file: tests[0].file, code: 1, output: "not ok 1 - adds\n  AssertionError: expected 1 to be 2" }, { file: tests[1].file, code: 0, output: "" }] });
  assert.equal(broke.broke, 1);
  assert.match(broke.text, /^BROKE one$/m);
  assert.match(broke.text, /^HELD two$/m);
  assert.match(broke.text, /1 of 2 break attempts found a hole/);
  const held = breakSummary({ author: "claude", model: "deepseek/deepseek-v4.1-flash", tests, results: tests.map((item) => ({ file: item.file, code: 0, output: "" })) });
  assert.equal(held.broke, 0);
  assert.match(held.text, /the fix held/);
  assert.match(breakSummary({ author: "grok", model: "m", tests, results: [] }).text, /unproven/);
});

test("the breaker is never the author's own model family", async () => {
  const { modelFor } = await load();
  assert.equal(modelFor("claude", ""), "deepseek/deepseek-v4.1-flash");
  assert.equal(modelFor("grok", "x-ai/grok-4"), "deepseek/deepseek-v4.1-flash");
  assert.throws(() => modelFor("deepseek", ""), /no other-family verifier configured/);
  assert.throws(() => modelFor("deepseek", "deepseek/deepseek-v4.1-flash"), /no other-family/);
  assert.equal(modelFor("deepseek", "x-ai/grok-4"), "x-ai/grok-4");
});

test("a broken fix posts a red break-it status and a comment that names the failure", async () => {
  const { main } = await load();
  const posts = [];
  const pr = { title: "HTPR-9408 [BUGFIX] keep the empty title from saving", body: "Summary.\n\nTicket: https://app.hypertask.ai/detail/project-15/9408\n\nAuthor-Model: claude", base: { sha: "a".repeat(40), ref: "production" } };
  const fetchImpl = async (url, init) => {
    posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    if (url.includes("openrouter")) return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ tests: [{ name: "blank-title", code: "const assert = require(\"node:assert/strict\");\nconst test = require(\"node:test\");\ntest(\"a blank title is rejected\", () => { assert.equal(1, 2); });\n" }] }) } }] }) };
    return { ok: true, json: async () => ({}) };
  };
  Object.assign(process.env, { GITHUB_REPOSITORY: "hypertask-ai/hypertask", GITHUB_RUN_ID: "42", PR: "7", HEAD_SHA: "b".repeat(40), OPENROUTER_EVAL_KEY: "sk-test-break-it-secret", GH_TOKEN: "ghs-test" });
  await main({ fetch: fetchImpl, git: (args) => (args.includes("--name-only") ? "src/lib/title.ts\n" : "- old\n+ new"), gh: () => JSON.stringify(pr) });
  const status = posts.find((item) => item.url.endsWith(`/statuses/${"b".repeat(40)}`));
  const comment = posts.find((item) => item.url.endsWith("/issues/7/comments"));
  assert.equal(status.body.state, "failure");
  assert.equal(status.body.context, "break-it");
  assert.match(comment.body.body, /BROKE blank-title/);
  assert.match(comment.body.body, /1 of 1 break attempts found a hole/);
  assert.equal(JSON.stringify(posts).includes("sk-test-break-it-secret"), false);
  assert.equal(JSON.stringify(posts).includes("ghs-test"), false);
  assert.equal(existsSync(path.join(root, "tests", "break-it")), false);
});

test("a pull request with no author model gets no quiet pass", async () => {
  const { main } = await load();
  const posts = [];
  const fetchImpl = async (url, init) => { posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) }); return { ok: true, json: async () => ({}) }; };
  Object.assign(process.env, { GITHUB_REPOSITORY: "hypertask-ai/hypertask", GITHUB_RUN_ID: "43", PR: "8", HEAD_SHA: "c".repeat(40), GH_TOKEN: "ghs-test" });
  await main({ fetch: fetchImpl, git: () => "", gh: () => JSON.stringify({ title: "HTPR-9408 [BUGFIX] x", body: "no author line", base: { sha: "a".repeat(40) } }) });
  assert.equal(posts[0].body.state, "failure");
  assert.match(posts[0].body.description, /no Author-Model/);
});
