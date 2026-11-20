const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const head = "b".repeat(40);
const load = () => import(path.join(root, ".github/scripts/break-it-review.mjs"));
const pull = (body, extra = {}) => ({ title: "HTPR-9408 [BUGFIX] keep the empty title from saving", body, base: { sha: "a".repeat(40), ref: "production" }, ...extra });
const good = "const assert = require(\"node:assert/strict\");\nconst test = require(\"node:test\");\nconst { loadModule } = require(\"../helpers/loadModule.cjs\");\ntest(\"adds\", () => { assert.equal(loadModule(\"src/lib/flags/index.ts\") ? 2 : 2, 2); });\n";

async function runMain({ reply, name = "blank-title", io = {}, item = pull("Author-Model: claude"), key = "sk-test-break-it-secret", token = "ghs-test" } = {}) {
  const { main } = await load();
  const posts = [];
  const fetchImpl = async (url, init) => {
    posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    const content = !reply || !String(url).includes("openrouter") ? {} : { choices: [{ message: { content: JSON.stringify({ tests: [{ name, code: reply }] }) } }] };
    return { ok: true, json: async () => content };
  };
  Object.assign(process.env, { GITHUB_REPOSITORY: "hypertask-ai/hypertask", GITHUB_RUN_ID: "42", PR: "7", HEAD_SHA: head, OPENROUTER_EVAL_KEY: key, GH_TOKEN: token });
  try {
    await main({ fetch: fetchImpl, git: (args) => (args.includes("--name-only") ? "src/lib/title.ts\n" : "- old\n+ new"), gh: () => JSON.stringify(item), ...io });
  } finally {
    delete process.env.OPENROUTER_EVAL_KEY;
    delete process.env.GH_TOKEN;
  }
  return posts;
}

async function runCli({ reply = "", item = pull("Author-Model: claude"), io = {} } = {}) {
  const { cli } = await load();
  const lines = [];
  const out = process.stdout.write, err = process.stderr.write, before = process.exitCode;
  process.stdout.write = (chunk) => { lines.push(["stdout", String(chunk)]); return true; };
  process.stderr.write = (chunk) => { lines.push(["stderr", String(chunk)]); return true; };
  Object.assign(process.env, { GITHUB_REPOSITORY: "hypertask-ai/hypertask", GITHUB_RUN_ID: "42", PR: "7", HEAD_SHA: head, OPENROUTER_EVAL_KEY: "sk-test-break-it-secret", GH_TOKEN: "ghs-test" });
  const fetchImpl = async (url) => ({ ok: true, json: async () => (String(url).includes("openrouter") ? { choices: [{ message: { content: reply } }] } : {}) });
  try {
    const status = await cli({ fetch: fetchImpl, git: () => "- old\n+ new", gh: () => JSON.stringify(item), spawn: () => ({ status: 0, stdout: "", stderr: "" }), ...io });
    const text = (stream) => lines.filter(([name]) => name === stream).map(([, value]) => value).join("");
    return { status, code: process.exitCode, stdout: text("stdout"), stderr: text("stderr") };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
    process.exitCode = before;
    delete process.env.OPENROUTER_EVAL_KEY;
    delete process.env.GH_TOKEN;
  }
}

function needsBubblewrap() {
  if (spawnSync("bwrap", ["--version"]).status === 0) return;
  const install = spawnSync("bash", ["-lc", "sudo apt-get update -qq && sudo apt-get install -y bubblewrap"], { encoding: "utf8", timeout: 180000 });
  assert.equal(install.status, 0, (install.stderr || "bubblewrap missing").slice(0, 300));
}

test("the break prompt carries the diff, the author family and the ticket, never the key", async () => {
  const { breakPrompt } = await load();
  process.env.OPENROUTER_EVAL_KEY = "sk-test-break-it-secret";
  const prompt = breakPrompt({ author: "deepseek", ticket: "https://app.hypertask.ai/detail/project-15/9408", diff: "- old line\n+ new line", files: ["src/app/page.tsx"] });
  delete process.env.OPENROUTER_EVAL_KEY;
  for (const expected of [/author model family is deepseek/, /\+ new line/, /https:\/\/app\.hypertask\.ai\/detail\/project-15\/9408/, /src\/app\/page\.tsx/, /at most 3 tests/, /under 1200 characters/, /whole answer under 3500 characters/]) assert.match(prompt, expected);
  assert.equal(prompt.includes("sk-test-break-it-secret"), false);
});

test("the parser accepts one honest test and refuses the ways a model answer goes wrong", async () => {
  const { parseBreakTests } = await load();
  const parsed = parseBreakTests(JSON.stringify({ tests: [{ name: "Empty Title", code: good }] }));
  assert.deepEqual(parsed.map((item) => item.file), ["break-it-empty-title.test.cjs"]);
  assert.equal(parseBreakTests(JSON.stringify({ tests: [{ name: "sneaky", code: `${good}\nrequire("node:" + "child_process");\n` }] }))[0].name, "sneaky");
  for (const [payload, refused] of [
    [{ tests: ["a", "b", "c", "d"].map((name) => ({ name, code: good })) }, /no usable tests/],
    [{ tests: [{ name: "a", code: good.replace('require("node:test")', 'require("node:assert")') }] }, /does not use node:test/],
    [{ tests: [{ name: "a", code: "tiny" }] }, /wrong size/],
  ]) assert.throws(() => parseBreakTests(JSON.stringify(payload)), refused);
  assert.throws(() => parseBreakTests("not json at all"), /was not JSON/);
});

test("the parser reads JSON that arrives fenced, wrapped in prose, or both", async () => {
  const { parseBreakTests } = await load();
  const payload = JSON.stringify({ tests: [{ name: "empty-title", code: good }] });
  const files = ["break-it-empty-title.test.cjs"];
  for (const answer of [
    "```json\n" + payload + "\n```",
    `Here are the tests I would run.\n\n${payload}\n\nEach one fails on the old code.`,
    `Sure.\n\`\`\`json\n${payload}\n\`\`\`\nLet me know if you want a fourth {test}.`,
    `Note {"tests":"not an array"} then\n\`\`\`json\n${payload}\n\`\`\``,
  ]) assert.deepEqual(parseBreakTests(answer).map((item) => item.file), files, answer);
});

async function runWithAnswers(answers) {
  const { main } = await load();
  const posts = [], lines = [];
  let calls = 0;
  const fetchImpl = async (url, init) => {
    if (String(url).includes("openrouter")) {
      const content = answers[Math.min(calls, answers.length - 1)];
      calls += 1;
      return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
    }
    posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return { ok: true, json: async () => ({}) };
  };
  Object.assign(process.env, { GITHUB_REPOSITORY: "hypertask-ai/hypertask", GITHUB_RUN_ID: "42", PR: "7", HEAD_SHA: head, OPENROUTER_EVAL_KEY: "sk-test-break-it-secret", GH_TOKEN: "ghs-test" });
  try {
    const status = await main({
      fetch: fetchImpl,
      git: (args) => (args.includes("--name-only") ? "src/lib/title.ts\n" : "- old\n+ new"),
      gh: () => JSON.stringify(pull("Author-Model: claude")),
      spawn: () => ({ status: 0, stdout: "", stderr: "" }),
      log: (line) => lines.push(line),
      warn: () => {},
    });
    return { status, posts, lines, calls: () => calls };
  } finally {
    delete process.env.OPENROUTER_EVAL_KEY;
    delete process.env.GH_TOKEN;
  }
}

const fenced = (code = good) => "```json\n" + JSON.stringify({ tests: [{ name: "blank-title", code }] }) + "\n```";

test("an answer that arrives as prose is asked for once more and the reason is printed", async () => {
  const run = await runWithAnswers(["My plan: read the title validator and then decide.", fenced()]);
  const comments = run.posts.filter((entry) => String(entry.url).endsWith("/issues/7/comments"));
  assert.deepEqual([run.calls(), run.status.state], [2, "success"]);
  assert.equal(run.lines.join("\n").includes("could not be read"), true);
  assert.equal(run.lines.join("\n").includes("asking once more"), true);
  assert.equal(comments.length, 1);
  assert.equal(/HELD blank-title/.test(comments[0].body.body), true);
});

test("a second unreadable answer fails the step with the reason and asks no third time", async () => {
  const run = await runWithAnswers(["no json here", "still", fenced()]);
  assert.deepEqual([run.calls(), run.status.state], [2, "failure"]);
  assert.equal(run.lines.join("\n").includes("asking once more"), true);
  assert.equal(/could not run: model answer was not JSON/.test(run.status.text), true);
});

test("broken attempts are named as broken, held attempts as held, and the rest unproven", async () => {
  const { breakSummary } = await load();
  const tests = [{ name: "one", file: "break-it-one.test.cjs" }, { name: "two", file: "break-it-two.test.cjs" }];
  const summary = (results) => breakSummary({ author: "claude", model: "deepseek/deepseek-v4.1-flash", tests, results });
  const broke = summary([{ file: tests[0].file, code: 1, output: "not ok 1 - adds\n  AssertionError: expected 1 to be 2" }, { file: tests[1].file, code: 0, output: "" }]);
  assert.deepEqual([broke.broke, /^BROKE one$/m.test(broke.text), /^HELD two$/m.test(broke.text), /1 of 2 break attempts found a hole/.test(broke.text)], [1, true, true, true]);
  const held = summary(tests.map((item) => ({ file: item.file, code: 0, output: "" })));
  assert.deepEqual([held.broke, /the fix held/.test(held.text)], [0, true]);
  assert.match(summary([]).text, /unproven/);
  for (const result of [{ status: null, signal: "SIGTERM", error: "timed out", output: "" }, { code: 1, output: "not ok 1 - one\nSyntaxError: Unexpected token" }]) {
    const unproven = summary([{ file: tests[0].file, ...result }]);
    assert.equal(unproven.broke, 0);
    assert.match(unproven.text, /^UNPROVEN one$[\s\S]*break attempts were unproven/m);
  }
});

test("the breaker is never the author's own model family", async () => {
  const { modelFor } = await load();
  assert.deepEqual([modelFor("claude", ""), modelFor("grok", "x-ai/grok-4"), modelFor("deepseek", "x-ai/grok-4")], ["deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash", "x-ai/grok-4"]);
  assert.throws(() => modelFor("deepseek", ""), /no other-family verifier configured/);
  assert.throws(() => modelFor("deepseek", "deepseek/deepseek-v4.1-flash"), /no other-family/);
});

test("a review that could not run prints its reason in the step log and fails the step", async () => {
  const answer = "I read the diff and here is what I think the edge cases are, but I ran out of room before the tests.";
  const { status, code, stdout, stderr } = await runCli({ reply: answer });
  assert.equal(status.state, "failure");
  assert.match(stdout, /Break-it review could not run: .*JSON/);
  assert.match(stderr, /^::error title=Break-it review::Break-it review could not run: .*JSON/m);
  assert.deepEqual([code, stdout.includes("sk-test-break-it-secret"), stderr.includes("sk-test-break-it-secret")], [1, false, false]);
});

test("a break attempt that held prints its result and leaves the step green", async () => {
  const { status, code, stdout } = await runCli({ reply: JSON.stringify({ tests: [{ name: "blank-title", code: good }] }) });
  assert.equal(status.state, "success");
  assert.match(stdout, /HELD blank-title[\s\S]*the fix held/);
  assert.equal(code, 0);
});

test("a pull request that is not a bugfix says it was skipped instead of going quiet", async () => {
  const { status, code, stdout } = await runCli({ item: pull("Author-Model: claude", { title: "HTPR-1 [FEATURE] add a button" }) });
  assert.deepEqual([status.state, /skipped/.test(stdout), code], ["skipped", true, 0]);
});

test("a broken fix posts a red break-it status and a comment that names the failure", async () => {
  const posts = await runMain({
    reply: "const assert = require(\"node:assert/strict\");\nconst test = require(\"node:test\");\ntest(\"a blank title is rejected\", () => { assert.equal(1, 2); });\n",
    item: pull("Summary.\n\nTicket: https://app.hypertask.ai/detail/project-15/9408\n\nAuthor-Model: claude"),
    io: { spawn: () => ({ status: 1, stdout: "not ok 1 - a blank title is rejected\nAssertionError: expected 1 to be 2\n", stderr: "" }) },
  });
  const status = posts.find((entry) => entry.url.endsWith(`/statuses/${head}`));
  const comment = posts.find((entry) => entry.url.endsWith("/issues/7/comments"));
  assert.deepEqual([status.body.state, status.body.context], ["failure", "break-it"]);
  assert.match(comment.body.body, /BROKE blank-title/);
  assert.match(comment.body.body, /1 of 1 break attempts found a hole/);
  const posted = JSON.stringify(posts);
  assert.deepEqual([posted.includes("sk-test-break-it-secret"), posted.includes("ghs-test"), existsSync(path.join(root, "tests", "break-it"))], [false, false, false]);
});

test("a pull request that cannot be judged fails closed instead of passing quietly", async () => {
  const noAuthor = await runMain({ item: pull("no author line", { title: "HTPR-9408 [BUGFIX] x" }) });
  assert.deepEqual([noAuthor[0].body.state, /no Author-Model/.test(noAuthor[0].body.description)], ["failure", true]);
  const noDeps = await runMain({ io: { deps: "failure" }, item: pull("Author-Model: claude", { title: "HTPR-9408 [BUGFIX] x" }) });
  assert.deepEqual([noDeps[0].body.state, /unproven/.test(noDeps[0].body.description), noDeps.some((entry) => /BROKE/.test(String(entry.body.body ?? "")))], ["failure", true, false]);
});

test("a generated test cannot see the key, the network, or the host", async () => {
  needsBubblewrap();
  const { sandboxLaunch } = await load();
  const outside = mkdtempSync(path.join(tmpdir(), "break-it-host-"));
  const hostFile = path.join(outside, "host-only.txt");
  const hostPwn = path.join(outside, "pwn.txt");
  const key = "sk-break-canary";
  const token = "ghs-break-canary";
  writeFileSync(hostFile, "host-only");
  const code = `const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const net = require("node:" + "net");
const hit = (buf) => buf.includes(${JSON.stringify(key)}) || buf.includes(${JSON.stringify(token)});
test("contained", async () => {
  assert.equal(process.env.OPENROUTER_EVAL_KEY, undefined);
  assert.equal(hit(fs.readFileSync("/proc/" + process.ppid + "/environ")), false);
  const leaked = fs.readdirSync("/proc").filter((pid) => /^\\d+$/.test(pid)).some((pid) => { try { return hit(fs.readFileSync("/proc/" + pid + "/environ")); } catch (error) { return false; } });
  assert.equal(leaked, false);
  assert.equal(fs.existsSync("/home"), false);
  try { fs["write" + "FileSync"](${JSON.stringify(hostPwn)}, "pwn"); } catch (error) {}
  const sawHost = () => { try { return fs.readFileSync(${JSON.stringify(hostFile)}, "utf8").includes("host-only"); } catch (error) { return false; } };
  assert.equal(sawHost(), false);
  const open = await new Promise((done) => { const socket = net.connect(443, "1.1.1.1"); const timer = setTimeout(() => { socket.destroy(); done(false); }, 400); socket.on("connect", () => { clearTimeout(timer); done(true); }); socket.on("error", () => { clearTimeout(timer); done(false); }); });
  assert.equal(open, false);
});
`;
  const repo = mkdtempSync(path.join(tmpdir(), "break-it-repo-"));
  const launch = sandboxLaunch(repo, "break-it-contained.test.cjs");
  assert.equal(launch.env.OPENROUTER_EVAL_KEY, undefined);
  assert.ok(launch.args.includes("--unshare-net") && launch.args.includes("--unshare-pid"));
  const posts = await runMain({ reply: code, name: "contained", io: { repo }, key, token, item: pull("Author-Model: claude\n\nTicket: https://app.hypertask.ai/detail/project-15/9408") });
  const comment = posts.find((entry) => String(entry.url).endsWith("/issues/7/comments"));
  assert.match(comment.body.body, /HELD contained/);
  const posted = JSON.stringify(posts);
  assert.deepEqual([existsSync(hostPwn), readFileSync(hostFile, "utf8"), posted.includes(key), posted.includes(token)], [false, "host-only", false, false]);
  rmSync(repo, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});
