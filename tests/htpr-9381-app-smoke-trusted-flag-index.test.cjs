const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const folder = "src/lib/flags/definitions";
const isolated = path.join(repo, "scripts/run-app-smoke-isolated.sh");

function flagSource(key, identifier) {
  return `export const ${identifier} = "${key}";\nexport default { key: ${identifier}, shippedOn: "2026-10-10", description: "Fixture" } as const;\n`;
}

function writeFlag(root, key, identifier) {
  const directory = path.join(root, folder);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${key}.ts`), flagSource(key, identifier));
}

function installGenerator(trusted) {
  fs.mkdirSync(path.join(trusted, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(trusted, ".github/scripts"), { recursive: true });
  fs.copyFileSync(
    path.join(repo, "scripts/generate-flag-index.mjs"),
    path.join(trusted, "scripts/generate-flag-index.mjs"),
  );
  fs.copyFileSync(
    path.join(repo, ".github/scripts/feature-flag-registry.mjs"),
    path.join(trusted, ".github/scripts/feature-flag-registry.mjs"),
  );
  const typescriptDir = path.dirname(require.resolve("typescript/package.json"));
  fs.mkdirSync(path.join(trusted, "node_modules"), { recursive: true });
  fs.symlinkSync(typescriptDir, path.join(trusted, "node_modules/typescript"), "dir");
}

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "htpr-9381-smoke-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidate = path.join(root, "candidate");
  const trusted = path.join(root, "trusted");
  const bin = path.join(root, "bin");
  fs.mkdirSync(candidate, { recursive: true });
  fs.mkdirSync(trusted, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  const docker = path.join(bin, "docker");
  const log = path.join(root, "docker.log");
  fs.writeFileSync(log, "");
  fs.writeFileSync(docker, "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$SMOKE_DOCKER_LOG\"\nexit 1\n");
  fs.chmodSync(docker, 0o755);
  installGenerator(trusted);
  return { root, candidate, trusted, bin, log };
}

function runIsolated({ candidate, trusted, bin, log }) {
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    SMOKE_DOCKER_LOG: log,
  };
  delete env.NODE_OPTIONS;
  return spawnSync("bash", [isolated, candidate, trusted], { encoding: "utf8", env });
}

function indexText(root) {
  return fs.readFileSync(path.join(root, folder, "index.generated.ts"), "utf8");
}

test("flag index generator writes index.generated.ts for the checkout argument", (t) => {
  const { trusted } = workspace(t);
  writeFlag(trusted, "htpr-9-trusted", "TRUSTED_FLAG");
  const result = spawnSync(
    process.execPath,
    [path.join(trusted, "scripts/generate-flag-index.mjs"), trusted],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const generated = indexText(trusted);
  assert.ok(generated.includes('export { TRUSTED_FLAG } from "./htpr-9-trusted"'));
  assert.ok(generated.includes("export const FLAG_DEFINITIONS"));
});

test("app smoke writes the trusted flag index before containers start", (t) => {
  const fixture = workspace(t);
  writeFlag(fixture.candidate, "htpr-1-candidate", "CANDIDATE_FLAG");
  writeFlag(fixture.trusted, "htpr-9-trusted", "TRUSTED_FLAG");
  const result = runIsolated(fixture);
  assert.equal(result.status, 1, result.stderr);
  assert.match(fs.readFileSync(fixture.log, "utf8"), /network create/);
  assert.ok(indexText(fixture.candidate).includes('export { CANDIDATE_FLAG } from "./htpr-1-candidate"'));
  assert.ok(indexText(fixture.trusted).includes('export { TRUSTED_FLAG } from "./htpr-9-trusted"'));
});

test("app smoke leaves a trusted checkout without flag definitions untouched", (t) => {
  const fixture = workspace(t);
  writeFlag(fixture.candidate, "htpr-1-candidate", "CANDIDATE_FLAG");
  const result = runIsolated(fixture);
  assert.equal(result.status, 1, result.stderr);
  assert.match(fs.readFileSync(fixture.log, "utf8"), /network create/);
  assert.ok(indexText(fixture.candidate).includes('export { CANDIDATE_FLAG } from "./htpr-1-candidate"'));
  assert.equal(fs.existsSync(path.join(fixture.trusted, folder, "index.generated.ts")), false);
});
