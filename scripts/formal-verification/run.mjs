#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const record = JSON.parse(readFileSync(path.join(root, "verification/formal/checks.json"), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function tlcJar() {
  if (process.env.TLA2TOOLS) return process.env.TLA2TOOLS;
  const cache = process.env.TLC_CACHE_DIR ?? path.join(homedir(), ".cache", "hypertask-tlc");
  const jar = path.join(cache, `tla2tools-${record.tool.version}.jar`);
  if (existsSync(jar) && digest(readFileSync(jar)) === record.tool.sha256) return jar;
  mkdirSync(cache, { recursive: true });
  const response = await fetch(record.tool.jar);
  if (!response.ok) throw new Error(`cannot download ${record.tool.jar}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== record.tool.sha256) throw new Error(`${record.tool.jar} does not match sha256 ${record.tool.sha256}`);
  writeFileSync(`${jar}.${process.pid}`, bytes);
  renameSync(`${jar}.${process.pid}`, jar);
  return jar;
}

async function javaBinary() {
  const java = process.env.JAVA ?? "java";
  await run(java, ["-version"]).catch(() => {
    throw new Error(`no ${java} on this machine: install a Java 11+ runtime or set JAVA`);
  });
  return java;
}

const traceActions = (out) => [...out.matchAll(/<\s*(\w+) line/g)].map((m) => m[1]);
const inOrder = (actions, witness) => {
  let at = 0;
  for (const action of actions) if (action === witness[at]) at += 1;
  return at === witness.length;
};
const violated = (out) => [...out.matchAll(/Error: Invariant (\w+) is violated/g)].map((m) => m[1]);

async function check(check, property) {
  const spec = path.join(root, check.spec);
  const base = readFileSync(path.join(root, check.config), "utf8").trimEnd();
  const config = path.join(tmpdir(), `formal-${check.id}-${property}-${process.pid}.cfg`);
  writeFileSync(config, `${base}\nINVARIANTS\n  ${property}\n`);
  const meta = mkdtempSync(path.join(tmpdir(), `formal-${check.id}-`));
  const args = ["-XX:+UseParallelGC", `-Djava.io.tmpdir=${meta}`, "-cp", await tlcJar(), "tlc2.TLC", "-workers", "1", "-metadir", meta, "-config", config, path.basename(spec)];
  const done = await run(await javaBinary(), args, { cwd: path.dirname(spec), maxBuffer: 64 * 1024 * 1024 })
    .then((ok) => ({ ...ok, status: 0 }))
    .catch((error) => ({ stdout: error.stdout, stderr: error.stderr, status: error.code ?? -1 }));
  const out = `${done.stdout ?? ""}${done.stderr ?? ""}`.trim();
  return { status: done.status, out, broke: violated(out) };
}

const wanted = process.argv.slice(2);
const ids = Object.keys(record.checks).filter((id) => wanted.length === 0 || wanted.includes(id));
if (ids.length === 0) {
  console.error(`formal-verification: no check named ${wanted.join(" ")}; known: ${Object.keys(record.checks).join(" ")}`);
  process.exit(2);
}

let failed = 0;
for (const id of ids) {
  const checkRecord = { ...record.checks[id], id };
  const problems = [];
  const summary = [];
  let detail = "";
  for (const property of checkRecord.properties) {
    let actual = false;
    let out = "";
    const before = problems.length;
    try {
      const result = await check(checkRecord, property.name);
      out = result.out;
      actual = result.broke.includes(property.name);
      if (![0, 12].includes(result.status)) problems.push(`${property.name}: TLC exited ${result.status}`);
      if (actual !== (property.expect === "violated")) problems.push(`${property.name} expected ${property.expect}, got ${actual ? "violated" : "holds"}`);
      if (actual && property.witness && !inOrder(traceActions(out), property.witness)) {
        problems.push(`${property.name} violated on another path than the record (${property.witness.join(" then ")})`);
      }
      if (actual && !property.witness) problems.push(`${property.name} violated without a recorded path`);
    } catch (error) {
      problems.push(`${property.name} could not run: ${error.message}`);
    }
    summary.push(`${property.name} ${property.expect === "violated" ? "violated (recorded finding)" : "holds"}`);
    if (problems.length > before) detail = out;
  }
  console.log(`formal-verification: ${problems.length === 0 ? "ok" : "FAIL"} ${id} ${problems.length === 0 ? "matches its record" : problems.join("; ")} [${checkRecord.spec}] ${summary.join(", ")}`);
  if (problems.length > 0) {
    failed += 1;
    if (detail) console.error(detail);
  }
}
process.exit(failed === 0 ? 0 : 1);
