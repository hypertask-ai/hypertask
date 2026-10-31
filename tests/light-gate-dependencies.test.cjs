const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { isBuiltin } = require("node:module");
const { spawnSync } = require("node:child_process");
const yaml = require("js-yaml");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const workflowFiles = fs.readdirSync(path.join(root, ".github/workflows")).filter((file) => /\.ya?ml$/.test(file));

function imports(file, source = read(file)) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const dependencies = [];
  function add(specifier, node) {
    if (!isBuiltin(specifier)) dependencies.push({ specifier, location: `${file}:${parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1}` });
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add(node.moduleSpecifier.text, node);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) add(argument.text, node);
      else if (argument?.getText(parsed) === "process.env.FEATURE_FLAG_TYPESCRIPT_PATH" ||
          (argument && ts.isConditionalExpression(argument) && ts.isStringLiteralLike(argument.whenFalse) && argument.whenFalse.text === "typescript")) add("typescript", node);
      else if (!localFilePath(argument)) throw new Error(`${file}: untracked dynamic module load: ${node.getText(parsed)}`);
    }
    ts.forEachChild(node, visit);
  }
  function localFilePath(argument) {
    return Boolean(argument) && ts.isCallExpression(argument) && ts.isIdentifier(argument.expression) &&
      argument.expression.text === "pathToFileURL";
  }
  visit(parsed);
  return dependencies;
}

function scriptDependencies(file, seen = new Set()) {
  if (seen.has(file)) return [];
  seen.add(file);
  return imports(file).flatMap((dependency) => {
    if (!dependency.specifier.startsWith(".")) {
      const parts = dependency.specifier.split("/");
      return [{ ...dependency, package: parts.slice(0, parts[0].startsWith("@") ? 2 : 1).join("/") }];
    }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), dependency.specifier));
    if (target.endsWith(".json")) return [];
    assert.ok(fs.existsSync(path.join(root, target)), `${dependency.location}: unresolved relative import ${target}`);
    return scriptDependencies(target, seen);
  });
}

function shellWords(command) {
  return (command.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g) ?? []).map((word) => word.replace(/^["']|["']$/g, "").replace(/\/$/, ""));
}

function installations(run) {
  const installed = new Map();
  const copied = new Map();
  const commands = run.replace(/\\\n\s*/g, " ");
  for (const match of commands.matchAll(/\bcp\s+([^\n;]+)/g)) {
    const words = shellWords(match[1]);
    const manifest = words.find((word) => /(?:^|\/)package\.json$/.test(word));
    if (manifest) copied.set(words.at(-1), manifest.replace(/^(?:trusted|candidate)\//, ""));
  }
  for (const match of commands.matchAll(/(?:^|[;&|]|\bif|\bthen)\s*!?\s*npm\s+(?:ci|install)\b([^\n;]*)/gm)) {
    const words = shellWords(match[1]);
    const prefix = words.findIndex((word) => /^--prefix(?:=|$)/.test(word));
    if (prefix === -1) continue;
    const directory = words[prefix].startsWith("--prefix=") ? words[prefix].slice(9) : words[prefix + 1];
    const manifest = copied.get(directory) ?? `${directory}/package.json`;
    if (!fs.existsSync(path.join(root, manifest))) continue;
    const json = JSON.parse(read(manifest));
    for (const name of Object.keys({ ...json.dependencies, ...json.devDependencies })) installed.set(name, directory);
  }
  return installed;
}

function checkWorkflow(file, content) {
  const workflow = yaml.load(content, { schema: yaml.JSON_SCHEMA });
  if (file === "speed-live.yml") {
    assert.ok(workflow.on.schedule && !workflow.on.pull_request, "private live measurements are not a PR gate");
    return { issues: [], checked: 0 };
  }
  const issues = [];
  let checked = 0;
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    const steps = job.steps ?? [];
    const runs = steps.map((step) => step.run ?? "");
    const rootInstall = steps.some((step) => !step["working-directory"] && !job.defaults?.run?.["working-directory"] &&
      /(?:^|[;&|]|\bif|\bthen)\s*!?\s*npm\s+(?:ci|install)\b(?![^\n]*--prefix)/m.test(step.run ?? ""));
    if (rootInstall) continue;
    const nodeScripts = (run) => [...run.matchAll(/\bnode\s+(?:--[\w-]+\s+)*["']?((?:[\w.-]+\/)+[\w.-]+\.(?:mjs|cjs|js|ts))\b/g)]
      .map((match) => match[1].replace(/^(?:trusted|head)\//, "").replace(/^\.\//, ""));
    const runsVisualRunner = steps.some((step) => /node\s+\S*scripts\/visual-regression-ci\.mjs/.test(step.run ?? ""));
    if (file === "visual-regression.yml" || runsVisualRunner) {
      assert.match(read("scripts/visual-regression-ci.mjs"), /^\s+command\(root, env, \["npm", "ci"/m);
      continue;
    }
    const installed = new Map();
    for (const [index, step] of steps.entries()) {
      for (const entry of installations(step.run ?? "")) installed.set(...entry);
      const scripts = nodeScripts(step.run ?? "");
      if (!scripts.length) continue;
      checked += scripts.length;
      for (const script of scripts) {
        const dependencies = scriptDependencies(script);
        for (const dependency of dependencies) {
          if (!installed.has(dependency.package)) issues.push(`${file}:${jobName}:step ${index + 1}: ${dependency.location} loads ${dependency.package} without its own install`);
        }
        if (dependencies.some((dependency) => dependency.location.startsWith(".github/scripts/feature-flag-registry.mjs:"))) {
          const env = { ...workflow.env, ...job.env, ...step.env };
          const preceding = runs.slice(0, index + 1).join("\n");
          if (!env.FEATURE_FLAG_TYPESCRIPT_PATH && !/export FEATURE_FLAG_TYPESCRIPT_PATH=/.test(preceding)) {
            issues.push(`${file}:${jobName}: ${script} has no explicit FEATURE_FLAG_TYPESCRIPT_PATH`);
          }
        }
      }
    }
  }
  return { issues, checked };
}

test("light gate jobs install every transitive non-builtin dependency themselves", (t) => {
  let checked = 0;
  const issues = [];
  for (const file of workflowFiles) {
    const result = checkWorkflow(file, read(`.github/workflows/${file}`));
    checked += result.checked;
    issues.push(...result.issues);
  }
  assert.ok(checked > 0, "must discover actual light gate scripts");
  assert.deepEqual(issues, []);
  t.diagnostic(`Checked ${checked} Node script invocations across ${workflowFiles.length} workflows`);
});

test("negative control: removing either feature-flag job's parser install is caught", () => {
  const content = read(".github/workflows/feature-flag-gate.yml");
  const withoutInstall = content.replace(/npm ci --prefix "\$parser_dir" --ignore-scripts --no-audit --no-fund/g, "true");
  assert.notEqual(withoutInstall, content);
  const result = checkWorkflow("feature-flag-gate.yml", withoutInstall);
  assert.equal(result.checked, 3);
  assert.equal(result.issues.filter((issue) => /loads typescript without its own install/.test(issue)).length, 2);
  const freshWorkflow = `jobs:\n  gate:\n    steps:\n      - run: node .github/scripts/feature-flag-gate.mjs\n`;
  assert.match(checkWorkflow("new-light-gate.yml", freshWorkflow).issues.join("\n"), /loads typescript without its own install/);
});

test("dependency discovery follows ESM imports, re-exports, dynamic imports and CommonJS subpaths", () => {
  assert.deepEqual(imports("fixture.mjs", `
    import fs from "node:fs";
    import "./registry.mjs";
    export { value } from "@scope/parser/subpath";
    const a = require("parser/lib/main.js");
    const b = import("another-parser");
  `).map((entry) => entry.specifier), ["./registry.mjs", "@scope/parser/subpath", "parser/lib/main.js", "another-parser"]);
  assert.deepEqual(imports("fixture.mjs", 'const local = await import(pathToFileURL(join(directory, "local.mjs")));'), []);
  assert.throws(() => imports("fixture.mjs", "require(process.env.UNKNOWN_PARSER)"), /untracked dynamic module load/);
});

test("a different job's install cannot satisfy a light gate and an export alone is not an install", () => {
  const content = `jobs:
  installer:
    steps:
      - run: npm ci --prefix .github/scripts/feature-flag-parser
  gate:
    steps:
      - run: |
          export FEATURE_FLAG_TYPESCRIPT_PATH=/parser/node_modules/typescript/lib/typescript.js
          node .github/scripts/feature-flag-gate.mjs
`;
  assert.match(checkWorkflow("missing.yml", content).issues.join("\n"), /loads typescript without its own install/);
});

for (const script of ["feature-flag-gate.mjs", "feature-flag-registry.mjs"]) {
  for (const parser of [undefined, path.join(root, "missing-feature-flag-typescript.cjs")]) {
    test(`${script} fails closed with ${parser === undefined ? "unset" : "missing"} parser`, () => {
      const env = { ...process.env };
      delete env.FEATURE_FLAG_TYPESCRIPT_PATH;
      if (parser !== undefined) env.FEATURE_FLAG_TYPESCRIPT_PATH = parser;
      const result = spawnSync(process.execPath, [path.join(root, ".github/scripts", script), "YPER4-609 [INFRA] parser", "HEAD", "HEAD"], { cwd: root, env, encoding: "utf8" });
      assert.ifError(result.error);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^Missing TypeScript parser: FEATURE_FLAG_TYPESCRIPT_PATH=.+\n$/);
      assert.doesNotMatch(result.stdout + result.stderr, /\b(?:PASS|APPROVE|approved|passed)\b/i);
    });
  }
}

test("an explicit installed parser still permits the unchanged non-UI gate", () => {
  const result = spawnSync(process.execPath, [path.join(root, ".github/scripts/feature-flag-gate.mjs"), "YPER4-609 [INFRA] parser", "HEAD", "HEAD"], {
    cwd: root,
    env: { ...process.env, FEATURE_FLAG_TYPESCRIPT_PATH: require.resolve("typescript") },
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No changed file matches the UI\/server-change path filter/);
});

for (const script of ["scripts/generate-flag-index.mjs", "scripts/flags/production-flag-modes.mjs"]) {
  test(`${script} explicitly supplies the repo parser before importing the registry`, () => {
    const env = { ...process.env };
    delete env.FEATURE_FLAG_TYPESCRIPT_PATH;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(path.join(root, script))}); console.log(process.env.FEATURE_FLAG_TYPESCRIPT_PATH);`], { cwd: root, env, encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), require.resolve("typescript"));
  });
}

test("comments and echo text cannot pretend to install a dependency", () => {
  for (const fake of ["# npm ci", 'echo "npm ci"', '# npm ci --prefix .github/scripts/feature-flag-parser', 'echo "npm ci --prefix .github/scripts/feature-flag-parser"']) {
    const content = `jobs:\n  gate:\n    steps:\n      - run: |\n          ${fake}\n          node .github/scripts/feature-flag-gate.mjs\n`;
    assert.match(checkWorkflow("fake-install.yml", content).issues.join("\n"), /loads typescript without its own install/);
  }
});

test("the dependency check's own workflow also needs its TypeScript install", () => {
  const content = read(".github/workflows/node-version-guard.yml");
  const withoutInstall = content.replace("npm ci --prefix .github/scripts/feature-flag-parser --ignore-scripts --no-audit --no-fund", "echo parser install omitted");
  assert.notEqual(withoutInstall, content);
  assert.match(checkWorkflow("node-version-guard.yml", withoutInstall).issues.join("\n"), /light-gate-dependencies\.test\.cjs:.*loads typescript without its own install/);
});
