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
const { resolveAllowlistBase } = require("../scripts/lib/source-text-allowlist-base.cjs");

const root = resolve(__dirname, "..");
const allowlistPath = join(root, "tests/source-text-regex-allowlist.json");
const { allowlist } = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));

function git(args, cwd = root) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function branchBaseRef() {
  try {
    return resolveAllowlistBase(git);
  } catch {
    return "origin/production";
  }
}

const baseRef = branchBaseRef();

function readBaseAllowlist() {
  try {
    git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
  } catch {
    const branch = baseRef.startsWith("origin/") ? baseRef.slice("origin/".length) : "";
    git(["fetch", "--depth=1", "--no-tags", "origin", branch ? `${branch}:refs/remotes/origin/${branch}` : baseRef]);
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
    `These paths are not on the branch's starting allowlist (${baseRef}):`,
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

test("no offender falls outside the branch's starting ceiling", () => {
  const { removed: newOffenders } = allowlistDiff(ceiling, currentOffenders);
  assert.deepEqual(newOffenders, [], [
    "New tests that read source files as text and regex-match them were detected:",
    ...newOffenders.map((file) => `  - ${file}`),
    "These tests assert implementation, not behavior. They break on harmless refactors.",
    "Assert observable behavior instead.",
    "Call the function, render the component, or hit the route and check the result.",
    `The ceiling is ${baseAllowlist ? baseRef : "this branch's allowlist, because its starting commit does not have the file yet"}.`,
    "The allowlist may only shrink. Existing offenders will be cleaned up in HTPR-7809.",
  ].join("\n"));
});

test("the allowlist equals the detected offenders exactly", () => {
  assertExactAllowlist(allowlist, currentOffenders);
});

test("the allowlist declares the number of paths it lists", () => {
  const declared = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
  assert.equal(
    declared.count,
    declared.allowlist.length,
    "Regenerate with scripts/generate-source-text-test-allowlist.mjs so count matches the paths.",
  );
});

test("the allowlist may only shrink against the branch's starting allowlist", () => {
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

function branchFixture(t) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "source-text-base-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run("init", "-q", "-b", "production", ".");
  run("config", "user.email", "ci@example.com");
  run("config", "user.name", "CI");
  return {
    dir,
    run,
    revParse: (ref) => run("rev-parse", ref).trim(),
    commit: (message) => {
      run("add", "-A");
      run("commit", "-q", "--allow-empty", "-m", message);
    },
    resolver: (env = {}) => resolveAllowlistBase((args) => run(...args), env),
  };
}

test("a branch keeps its starting ceiling while production deletes an allowlisted test", (t) => {
  const repo = branchFixture(t);
  const offender = join(repo.dir, "tests/offender.test.cjs");
  const allowlistFile = join(repo.dir, "tests/source-text-regex-allowlist.json");
  fs.mkdirSync(join(repo.dir, "tests"));
  fs.writeFileSync(offender, "const s = readFileSync('src/x.ts', 'utf8'); assert.match(s, /x/);\n");
  fs.writeFileSync(allowlistFile, JSON.stringify({ allowlist: ["tests/offender.test.cjs"] }));
  repo.commit("production holds one allowlisted offender");
  const fork = repo.revParse("HEAD");
  repo.run("checkout", "-q", "-b", "ci-runner-3/hyci-47");
  fs.writeFileSync(join(repo.dir, "branch.txt"), "branch work\n");
  repo.commit("branch work");
  repo.run("checkout", "-q", "-B", "production", fork);
  fs.rmSync(offender);
  fs.writeFileSync(allowlistFile, JSON.stringify({ allowlist: [] }));
  repo.commit("cleanup batch deletes the offender");
  const productionTip = repo.revParse("HEAD");
  repo.run("update-ref", "refs/remotes/origin/production", productionTip);
  repo.run("checkout", "-q", "ci-runner-3/hyci-47");
  assert.notEqual(productionTip, fork, "the cleanup batch must move production for this case to mean anything");
  assert.equal(repo.resolver(), fork);
});

test("a production push is judged against the commit before it, not itself", (t) => {
  const repo = branchFixture(t);
  fs.writeFileSync(join(repo.dir, "first.txt"), "one\n");
  repo.commit("production starts");
  const start = repo.revParse("HEAD");
  fs.writeFileSync(join(repo.dir, "second.txt"), "two\n");
  repo.commit("a push lands on production");
  const pushed = repo.revParse("HEAD");
  repo.run("update-ref", "refs/remotes/origin/production", pushed);
  assert.equal(repo.resolver(), start);
});

test("a single-commit tree resolves to its own ceiling instead of throwing", (t) => {
  const repo = branchFixture(t);
  fs.writeFileSync(join(repo.dir, "only.txt"), "one\n");
  repo.commit("the only commit");
  const only = repo.revParse("HEAD");
  repo.run("update-ref", "refs/remotes/origin/production", only);
  assert.equal(repo.resolver(), only);
});

test("a tree with no ancestry settles on the base commit its event pinned", (t) => {
  const repo = branchFixture(t);
  fs.writeFileSync(join(repo.dir, "one-commit.txt"), "one\n");
  repo.commit("a one-commit-deep checkout");
  const pinned = "9f2c1d8e4b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d";
  const shallow = (args) => {
    if (args[0] === "merge-base") throw new Error("fatal: no merge base in a one-commit checkout");
    return repo.run(...args);
  };
  assert.equal(resolveAllowlistBase(shallow, { SOURCE_TEXT_ALLOWLIST_BASE: pinned }), pinned);
  assert.throws(() => resolveAllowlistBase(shallow, {}), /no merge base/);
});

test("a pin newer than the branch start loses to the branch's real start", (t) => {
  const repo = branchFixture(t);
  const offender = join(repo.dir, "tests/offender.test.cjs");
  fs.mkdirSync(join(repo.dir, "tests"));
  fs.writeFileSync(offender, "const s = readFileSync('src/x.ts', 'utf8'); assert.match(s, /x/);\n");
  fs.writeFileSync(join(repo.dir, "tests/source-text-regex-allowlist.json"), JSON.stringify({ allowlist: ["tests/offender.test.cjs"] }));
  repo.commit("production holds one allowlisted offender");
  const fork = repo.revParse("HEAD");
  repo.run("checkout", "-q", "-b", "ci-runner-3/hyci-47");
  fs.writeFileSync(join(repo.dir, "branch.txt"), "branch work\n");
  repo.commit("branch work");
  repo.run("checkout", "-q", "-B", "production", fork);
  fs.rmSync(offender);
  fs.writeFileSync(join(repo.dir, "tests/source-text-regex-allowlist.json"), JSON.stringify({ allowlist: [] }));
  repo.commit("cleanup batch deletes the offender");
  const baseTipAtEvent = repo.revParse("HEAD");
  repo.run("checkout", "-q", "ci-runner-3/hyci-47");
  fs.writeFileSync(join(repo.dir, "later.txt"), "a push after the cleanup batch\n");
  repo.commit("the branch is pushed after the cleanup batch");
  repo.run("update-ref", "refs/remotes/origin/production", baseTipAtEvent);
  assert.equal(repo.resolver({ SOURCE_TEXT_ALLOWLIST_BASE: baseTipAtEvent }), fork);
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
  const { file } = writeFixture(t, "assertMount(fs.readFileSync(path.join(root, 'src/x.tsx'), 'utf8'), /title=/);");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: true,
    matchedVariables: ["readFileSync"],
  });
});

test("inline assert.match and assert.doesNotMatch on a source read are detected", (t) => {
  for (const source of [
    "assert.match(readFileSync('src/x.ts', 'utf8'), /x/);",
    "assert.doesNotMatch(readFileSync('src/x.ts', 'utf8'), /x/);",
  ]) {
    const { file } = writeFixture(t, source);
    assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
      offender: true,
      matchedVariables: ["readFileSync"],
    });
  }
});

test("an assertion helper that only parses source is not a regex offence", (t) => {
  const { file } = writeFixture(t, "assert(YAML.load(readFileSync('src/config.yml', 'utf8')).enabled);");
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: false,
    matchedVariables: [],
  });
});

test("a variable name reused in another test does not implicate its assertion", (t) => {
  const { file } = writeFixture(t, [
    "test('reads source', () => {",
    "  const source = readFileSync('src/x.ts', 'utf8');",
    "  assert.match(source, /x/);",
    "});",
    "test('reads a fixture', () => {",
    "  const source = 'plain';",
    "  assert.match(source, /plain/);",
    "});",
  ].join("\n"));
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(file, "utf8")), {
    offender: true,
    matchedVariables: ["source"],
  });
  const clean = writeFixture(t, [
    "test('reads source', () => {",
    "  const source = readFileSync('src/x.ts', 'utf8');",
    "});",
    "test('reads a fixture', () => {",
    "  const source = 'plain';",
    "  assert.match(source, /plain/);",
    "});",
  ].join("\n"));
  assert.deepEqual(detectSourceTextRegex(fs.readFileSync(clean.file, "utf8")), {
    offender: false,
    matchedVariables: [],
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
