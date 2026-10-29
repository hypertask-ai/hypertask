const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const modulePath = path.join(root, ".github/scripts/paid-api-cost-notes.mjs");

test("cost notes gate rejects new, duplicate and changed paid calls without current notes", async t => {
  const { checkCostNotes, callsInFile } = await import(modulePath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paid-cost-notes-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = args => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull } }).trim();
  const write = (file, content) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), content); };
  const commit = () => { git(["add", "."]); git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture"]); return git(["rev-parse", "HEAD"]); };
  git(["init", "-q", "--initial-branch=main"]);
  write("src/old.ts", 'export const get = () => fetch("https://example.test/old");');
  const base = commit();
  const file = "src/new.ts";
  const source = 'export const get = () => fetch("https://example.test/paid");';
  write(file, source);
  assert.throws(() => checkCostNotes(base, commit(), dir), /New network calls need cost notes/);
  const id = callsInFile(file, source)[0].id;
  const notes = { [id]: { maxUsdPerDay: 0.12, reason: "One metered query hourly at $0.005", source: "https://example.test/pricing" } };
  write(".github/paid-api-cost-notes.json", JSON.stringify(notes));
  assert.equal(checkCostNotes(base, commit(), dir), "paid API cost notes ok");
  notes[id].maxUsdPerDay = -1; write(".github/paid-api-cost-notes.json", JSON.stringify(notes));
  assert.throws(() => checkCostNotes(base, commit(), dir), /New network calls need cost notes/);
  notes[id].maxUsdPerDay = 0.12; write(".github/paid-api-cost-notes.json", JSON.stringify(notes));
  write(file, source.replace("/paid", "/different"));
  assert.throws(() => checkCostNotes(base, commit(), dir), /New network calls need cost notes/);
  write(file, 'export const get = () => fetch("https://example.test/old");');
  assert.throws(() => checkCostNotes(base, commit(), dir), /New network calls need cost notes/);
  fs.unlinkSync(path.join(dir, "src/old.ts"));
  assert.equal(checkCostNotes(base, commit(), dir), "paid API cost notes ok");
  write(file, 'export const get = () => fetch( ;');
  assert.throws(() => checkCostNotes(base, commit(), dir), /Cannot parse/);
});

test("network inventory includes direct HTTP and AI SDK requests, not comments or local helpers", async () => {
  const { callsInFile } = await import(modulePath);
  const calls = callsInFile("src/ai.ts", `
// fetch("fake")
const text = "streamText(fake)";
fetch("one"); globalThis.fetch("two"); axios.post("three");
streamText({ model }); gateway.getCredits(); localHelper();`);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => /^[a-f0-9]{64}$/.test(call.digest)));
  assert.deepEqual(calls.map(call => call.code.split("(")[0]), ["fetch", "globalThis.fetch", "axios.post", "streamText", "gateway.getCredits"]);
});
