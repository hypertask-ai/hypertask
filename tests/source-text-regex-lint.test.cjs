const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const { join, resolve } = require("node:path");
const {
  discoverTestFiles,
  detectSourceTextRegex,
  findOffenders,
  sampleEvenly,
  allowlistDiff,
} = require("../scripts/lib/source-text-regex-detector.cjs");

const root = resolve(__dirname, "..");
const allowlistPath = join(root, "tests/source-text-regex-allowlist.json");
const { allowlist } = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
const baseRef = process.env.SOURCE_TEXT_ALLOWLIST_BASE || "origin/production";

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readBaseAllowlist() {
  try {
    git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
  } catch {
    const branch = baseRef.startsWith("origin/") ? baseRef.slice("origin/".length) : baseRef;
    git(["fetch", "--depth=1", "origin", `${branch}:refs/remotes/origin/${branch}`]);
  }
  try {
    const parsed = JSON.parse(git(["show", `${baseRef}:tests/source-text-regex-allowlist.json`]));
    if (!Array.isArray(parsed.allowlist)) {
      throw new Error(`${baseRef} allowlist is missing an allowlist array`);
    }
    return parsed.allowlist;
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString() : "";
    if (/exists on disk, but not in|does not exist in|Path .* does not exist/.test(stderr)) {
      return null;
    }
    throw error;
  }
}

function growthMessage(added) {
  return [
    "The allowlist at tests/source-text-regex-allowlist.json may only shrink.",
    `These paths are not on ${baseRef}:`,
    ...added.map((path) => `  - ${path}`),
    "Assert observable behavior instead (call the function, render the component, hit the route).",
    "Removing a path when a test is fixed is allowed. Adding one is not.",
  ].join("\n");
}

function assertExactAllowlist(allowed, offenders) {
  const { added, removed } = allowlistDiff(allowed, offenders);
  const messages = [];
  if (removed.length > 0) {
    messages.push(
      "Offenders missing from the allowlist:",
      ...removed.map((path) => `  - ${path}`),
      "Fix these tests to assert observable behavior instead; do not add them to the allowlist.",
    );
  }
  if (added.length > 0) {
    messages.push(
      "Paths on the allowlist that no longer offend:",
      ...added.map((path) => `  - ${path}`),
      "Regenerate the allowlist for fixed tests: node scripts/generate-source-text-test-allowlist.mjs",
    );
  }
  assert.deepEqual({ added, removed }, { added: [], removed: [] }, messages.join("\n"));
}

function writeFixture(t, source) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "source-text-regex-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(join(dir, "tests"));
  const file = join(dir, "tests/fixture.test.cjs");
  fs.writeFileSync(file, source);
  return { dir, file };
}

const baseAllowlist = readBaseAllowlist();
const ceiling = baseAllowlist ?? allowlist;
const currentOffenders = findOffenders(root);

test("no offender falls outside the production ceiling", () => {
  const { removed: newOffenders } = allowlistDiff(ceiling, currentOffenders);
  assert.deepEqual(newOffenders, [], [
    "New tests that read source files as text and regex-match them were detected:",
    ...newOffenders.map((file) => `  - ${file}`),
    "These tests assert implementation, not behavior. They break on harmless refactors.",
    "Assert observable behavior instead.",
    "Call the function, render the component, or hit the route and check the result.",
    `The ceiling is ${baseAllowlist ? baseRef : "this branch's allowlist, because production does not have the file yet"}.`,
    "The allowlist may only shrink. Existing offenders will be cleaned up in HTPR-7809.",
  ].join("\n"));
});

test("the allowlist equals the detected offenders exactly", () => {
  assertExactAllowlist(allowlist, currentOffenders);
});

test("the allowlist may only shrink against the production allowlist", () => {
  if (baseAllowlist === null) return;
  const { added } = allowlistDiff(allowlist, baseAllowlist);
  assert.deepEqual(added, [], growthMessage(added));
});

test("the shrink check rejects new paths and accepts a shorter synthetic allowlist", () => {
  const base = ["tests/kept.test.cjs", "tests/fixed.test.cjs"];
  const grown = ["tests/kept.test.cjs", "tests/fixed.test.cjs", "tests/new-source-text.test.cjs"];
  const { added } = allowlistDiff(grown, base);
  assert.deepEqual(added, ["tests/new-source-text.test.cjs"]);
  assert.throws(() => assert.deepEqual(added, [], growthMessage(added)), {
    message: /may only shrink[\s\S]*tests\/new-source-text\.test\.cjs/,
  });
  assert.deepEqual(allowlistDiff(["tests/kept.test.cjs"], base).added, []);
});

test("exact equality rejects removing an offender and keeping a fixed test", () => {
  const allowed = ["tests/kept.test.cjs", "tests/fixed.test.cjs"];
  const offenders = ["tests/kept.test.cjs", "tests/missing.test.cjs"];
  assert.deepEqual(allowlistDiff(allowed, offenders), {
    added: ["tests/fixed.test.cjs"],
    removed: ["tests/missing.test.cjs"],
  });
  assert.throws(() => assertExactAllowlist(allowed, offenders), {
    message: /Offenders missing[\s\S]*tests\/missing\.test\.cjs[\s\S]*do not add them[\s\S]*Paths on the allowlist[\s\S]*tests\/fixed\.test\.cjs[\s\S]*Regenerate the allowlist/,
  });
  assert.throws(() => assertExactAllowlist(["tests/kept.test.cjs"], offenders), /tests\/missing\.test\.cjs/);
  assertExactAllowlist(["tests/kept.test.cjs"], ["tests/kept.test.cjs"]);
});

test("allowlist differences are sorted in both directions", () => {
  assert.deepEqual(allowlistDiff(["z", "a", "kept"], ["y", "b", "kept"]), {
    added: ["a", "z"],
    removed: ["b", "y"],
  });
});

test("a source path stored in an earlier string binding is detected", (t) => {
  const { dir, file } = writeFixture(t, "const p = 'src/x.ts'; const s = readFileSync(p,'utf8'); assert.match(s,/x/)");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: true,
    matchedVariables: ["s"],
  });
  assert.deepEqual(findOffenders(dir), ["tests/fixture.test.cjs"]);
});

test("a source path stored in an earlier expression-free template is detected", (t) => {
  const { file } = writeFixture(t, "let p = `src/x.ts`; var s = fs.readFileSync(p, 'utf8'); assert.doesNotMatch(s, /y/);");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: true,
    matchedVariables: ["s"],
  });
});

test("an earlier literal path can be passed through a path join", (t) => {
  const { file } = writeFixture(t, "const p = 'src/x.ts'; const s = readFileSync(join(root, p), 'utf8'); assert.match(s, /x/);");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: true,
    matchedVariables: ["s"],
  });
});

test("a nested source path literal is linked to its own asserted binding", (t) => {
  const { file } = writeFixture(t, "const source = fs.readFileSync(join(root, 'src/x.ts'), 'utf8'); const fixture = readFileSync('fixtures/x.txt', 'utf8'); assert.match(source, /x/); assert.match(fixture, /x/);");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: true,
    matchedVariables: ["source"],
  });
});

test("source path literals retain all supported path categories", (t) => {
  for (const path of ["src/x.ts", "lib/x.ts", "components/x.tsx", "pages/x.tsx", "app/x.tsx", ".github/workflows/ci.yml", "eslint-local-rules/x.cjs", "scripts/x.js", "scripts/x.mjs", "scripts/x.ts", "scripts/x.tsx", "tsconfig.json"]) {
    const { file } = writeFixture(t, `const s = readFileSync(${JSON.stringify(path)}, 'utf8'); assert.match(s, /x/);`);
    assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
      offender: true,
      matchedVariables: ["s"],
    });
  }
});

test("only the read path argument can identify a source file", (t) => {
  const { file } = writeFixture(t, "const s = readFileSync('fixtures/x.txt', 'src/x.ts'); assert.match(s, /x/);");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: false,
    matchedVariables: [],
  });
});

test("strings containing example code do not become real source reads", (t) => {
  const { file } = writeFixture(t, 'const example = "const s = readFileSync(\'src/x.ts\', \'utf8\'); assert.match(s, /x/);";');
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: false,
    matchedVariables: [],
  });
});

test("a source read does not implicate a different fixture variable", (t) => {
  const { dir, file } = writeFixture(t, "const source = readFileSync('src/x.ts', 'utf8'); const fixture = readFileSync('fixtures/x.txt', 'utf8'); assert.match(fixture, /x/);");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: false,
    matchedVariables: [],
  });
  assert.deepEqual(findOffenders(dir), []);
});

test("a clean file without a source read is not an offender", (t) => {
  const { dir, file } = writeFixture(t, "const fixture = 'example'; assert.match(fixture, /example/);");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: false,
    matchedVariables: [],
  });
  assert.deepEqual(findOffenders(dir), []);
});

test("a later path declaration does not qualify an earlier read", (t) => {
  const { file } = writeFixture(t, "const s = readFileSync(p, 'utf8'); const p = 'src/x.ts'; assert.match(s, /x/);");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: false,
    matchedVariables: [],
  });
});

test("a source path template binding is detected", (t) => {
  const { file } = writeFixture(t, "const p = `src/${name}.ts`; const s = readFileSync(p, 'utf8'); assert.match(s, /x/);");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: true,
    matchedVariables: ["s"],
  });
});

test("an assertion helper that reads source inline is detected", (t) => {
  const { file } = writeFixture(t, "assertMount(fs.readFileSync(path.join(root, 'src/x.tsx'), 'utf8'));");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: true,
    matchedVariables: ["readFileSync"],
  });
});

test("a parsed source file asserted field by field is not a regex offence", (t) => {
  const { file } = writeFixture(t, "const source = readFileSync('src/x.yml', 'utf8'); const parsed = YAML.load(source); assert.equal(parsed.on, 'push');");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: false,
    matchedVariables: [],
  });
});

test("test discovery is recursive and sorted and ignores other extensions", (t) => {
  const { dir, file } = writeFixture(t, "assert.equal(1, 1);");
  const nested = join(dir, "tests/nested");
  fs.mkdirSync(nested);
  fs.writeFileSync(join(nested, "a.test.ts"), "assert.equal(1, 1);");
  fs.writeFileSync(join(nested, "ignored.test.js"), "assert.equal(1, 1);");
  assert.deepEqual(discoverTestFiles(join(dir, "tests")), [file, join(nested, "a.test.ts")]);
});

test("even sampling includes both endpoints without duplicates", () => {
  assert.deepEqual(sampleEvenly(["a", "b", "c", "d", "e", "f", "g"], 4), ["a", "c", "e", "g"]);
  assert.deepEqual(sampleEvenly(["a", "b", "c"], 2), ["a", "c"]);
});

test("one sample selects the first entry and short lists are unchanged", () => {
  const list = ["a", "b", "c"];
  assert.deepEqual(sampleEvenly(list, 1), ["a"]);
  assert.equal(sampleEvenly(list, 3), list);
  assert.equal(sampleEvenly(list, 5), list);
  assert.deepEqual(sampleEvenly([], 1), []);
});

test("sample sizes must be positive integers even for empty lists", () => {
  for (const size of [0, -1, 1.5, NaN, Infinity, "1"]) {
    assert.throws(() => sampleEvenly(["a"], size), /positive integer/);
    assert.throws(() => sampleEvenly([], size), /positive integer/);
  }
});
