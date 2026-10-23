const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });

async function startupLines(runtime) {
  const { register } = load(path.join(root, "src/instrumentation.ts"));
  const lines = [];
  const info = console.info;
  const previous = { runtime: process.env.NEXT_RUNTIME, sweep: process.env.QSTASH_AUTO_REGISTER_SWEEP };
  process.env.NEXT_RUNTIME = runtime;
  process.env.QSTASH_AUTO_REGISTER_SWEEP = "false";
  console.info = (...args) => lines.push(args.join(" "));
  try {
    await register();
  } finally {
    console.info = info;
    if (previous.runtime === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = previous.runtime;
    if (previous.sweep === undefined) delete process.env.QSTASH_AUTO_REGISTER_SWEEP; else process.env.QSTASH_AUTO_REGISTER_SWEEP = previous.sweep;
  }
  return lines.filter((line) => line.startsWith("[node-runtime]"));
}

test("now logged: the Node server writes its exact version and floor result to the server log at startup", async () => {
  const lines = await startupLines("nodejs");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0].slice("[node-runtime] ".length));
  assert.equal(entry.version, process.version);
  assert.equal(typeof entry.meetsSecurityFloor, "boolean");
  assert.match(entry.securityFloor, /^\d+\.\d+\.\d+$/);
});

test("still hidden: the public version endpoint reports only pass or fail, never the exact Node version", () => {
  const route = fs.readFileSync(path.join(root, "src/app/api/version/route.ts"), "utf8");
  assert.doesNotMatch(route, /version:\s*process\.version|process\.versions?\b(?!\))/);
  assert.match(route, /meetsSecurityFloor: meetsNodeSecurityFloor\(process\.version\)/);
});

test("the edge runtime writes no Node runtime line", async () => {
  assert.deepEqual(await startupLines("edge"), []);
});
