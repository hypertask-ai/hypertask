const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const scriptUrl = pathToFileURL(path.join(root, ".github/scripts/component-reuse-gate.mjs")).href;
const reusePath = "src/components/PageComponents/Kanban/HeaderComponents/HeaderIconWrapper.tsx";

function declaration(control, source, reused = reusePath) {
  return `- \`${control}\` in \`${source}\` -> \`${reused}\``;
}

function noReuseDeclaration(control, source, reason) {
  return `- \`${control}\` in \`${source}\` -> No existing component fits: \`${reason}\``;
}

function writeFile(dir, relative, content) {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "component-reuse-gate-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  writeFile(dir, reusePath, "export default function HeaderIconWrapper() { return null; }\n");
  return { dir, git };
}

function commit(git, message) {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
  return git(["rev-parse", "HEAD"]).trim();
}

async function evaluate(prBody, baseSha, headSha, cwd) {
  const original = process.cwd();
  process.chdir(cwd);
  try {
    const { evaluateComponentReuse } = await import(scriptUrl);
    return evaluateComponentReuse({ prBody, baseSha, headSha });
  } finally {
    process.chdir(original);
  }
}

test("non-UI changes do not require a component declaration", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/value.ts", "export const value = 1;\n");
  writeFile(dir, "src/components/value.ts", "export const componentValue = 1;\n");
  const head = commit(git, "backend");

  assert.equal((await evaluate("", base, head, dir)).pass, true);
});

test("a new component without the section is rejected with the rule", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/NewToolbar.tsx", "export const NewToolbar = () => <div />;\n");
  const head = commit(git, "new toolbar");

  const result = await evaluate("## Outcome\nNew toolbar", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.message, /^Every PR that touches the UI must name the existing component it reuses for each new control\./);
  assert.match(result.message, /src\/components\/NewToolbar\.tsx/);
});

test("inline menu markup without the section is rejected", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/app/example/page.tsx", "export default function Page() { return <button>Open</button>; }\n");
  const base = commit(git, "base");
  writeFile(
    dir,
    "src/app/example/page.tsx",
    'export default function Page() { return <><button aria-haspopup="menu">Open</button><div role="menu">Item</div></>; }\n',
  );
  const head = commit(git, "inline menu");

  assert.equal((await evaluate("", base, head, dir)).pass, false);
});

test("namespace-style inline menus require reuse declarations", async (t) => {
  const { dir, git } = makeRepo(t);
  const source = "src/app/example/page.tsx";
  writeFile(dir, source, "export const Page = () => <button>Open</button>;\n");
  const base = commit(git, "base");
  writeFile(
    dir,
    source,
    'import * as DropdownMenu from "@/components/PageComponents/Kanban/HeaderComponents/HeaderIconWrapper";\nexport const Page = () => <DropdownMenu.Root />;\n',
  );
  const head = commit(git, "namespace menu");

  const result = await evaluate("", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.message, /Page/);
});

test("a declaration mapping the changed file to an imported base component passes", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  const source = "src/components/NewToolbar.tsx";
  writeFile(
    dir,
    source,
    'import HeaderIconWrapper from "@/components/PageComponents/Kanban/HeaderComponents/HeaderIconWrapper";\nexport const NewToolbar = () => <HeaderIconWrapper />;\n',
  );
  const head = commit(git, "new toolbar");
  const body = `## Components reused\n\n${declaration("NewToolbar", source)}\n\n## Tests\n- passed`;

  const result = await evaluate(body, base, head, dir);
  assert.equal(result.pass, true);
  assert.match(result.message, new RegExp(reusePath.replaceAll("/", "\\/")));
});

test("a declaration naming a missing or newly added component is rejected", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  const source = "src/components/NewToolbar.tsx";
  writeFile(dir, source, "export const NewToolbar = () => <div />;\n");
  const head = commit(git, "new toolbar");

  for (const namedPath of ["src/components/DoesNotExist.tsx", source]) {
    const result = await evaluate(
      `## Components reused\n\n${declaration("NewToolbar", source, namedPath)}`,
      base,
      head,
      dir,
    );
    assert.equal(result.pass, false, namedPath);
    assert.match(result.message, /do not exist on the base branch/);
  }
});

test("every triggering file needs its own mapping", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  const first = "src/components/FirstControl.tsx";
  const second = "src/components/SecondControl.tsx";
  writeFile(
    dir,
    first,
    'import HeaderIconWrapper from "@/components/PageComponents/Kanban/HeaderComponents/HeaderIconWrapper";\nexport const FirstControl = () => <HeaderIconWrapper />;\n',
  );
  writeFile(
    dir,
    second,
    'import HeaderIconWrapper from "@/components/PageComponents/Kanban/HeaderComponents/HeaderIconWrapper";\nexport const SecondControl = () => <HeaderIconWrapper />;\n',
  );
  const head = commit(git, "two controls");

  const result = await evaluate(`## Components reused\n\n${declaration("FirstControl", first)}`, base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.message, /SecondControl\.tsx/);
  assert.match(result.message, /no mapping/);
});

test("the reused component must be imported by the mapped control file", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  const source = "src/components/NewToolbar.tsx";
  writeFile(
    dir,
    source,
    '// import HeaderIconWrapper from "@/components/PageComponents/Kanban/HeaderComponents/HeaderIconWrapper";\nexport const NewToolbar = () => <div />;\n',
  );
  const head = commit(git, "unrelated declaration");

  const result = await evaluate(`## Components reused\n\n${declaration("NewToolbar", source)}`, base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.message, /must be used by its named control/);
});

test("an imported component must be used by every control that claims it", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  const source = "src/components/TwoControls.tsx";
  writeFile(
    dir,
    source,
    'import HeaderIconWrapper from "@/components/PageComponents/Kanban/HeaderComponents/HeaderIconWrapper";\nexport const FirstControl = () => <HeaderIconWrapper />;\nexport const SecondControl = () => <button>Second</button>;\n',
  );
  const head = commit(git, "two controls in one file");
  const body = `## Components reused\n\n${declaration("FirstControl", source)}\n${declaration("SecondControl", source)}`;

  const result = await evaluate(body, base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.message, /TwoControls\.tsx:SecondControl/);
  assert.match(result.message, /must be used by its named control/);
});

test("shadowed parameters, locals, and property keys do not certify an unused import", async (t) => {
  for (const [label, control] of [
    ["parameter", "export const Control = (HeaderIconWrapper) => <button />;"],
    ["local", "export const Control = () => { const HeaderIconWrapper = () => null; return <button />; };"],
    ["property", "export const Control = () => { const value = { HeaderIconWrapper: true }; return <button>{String(value.HeaderIconWrapper)}</button>; };"],
  ]) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    const source = `src/components/Shadowed-${label}.tsx`;
    writeFile(
      dir,
      source,
      `import HeaderIconWrapper from "@/components/PageComponents/Kanban/HeaderComponents/HeaderIconWrapper";\n${control}\n`,
    );
    const head = commit(git, `shadowed ${label}`);
    const body = `## Components reused\n\n${declaration("Control", source)}`;

    const result = await evaluate(body, base, head, dir);
    assert.equal(result.pass, false, label);
    assert.match(result.message, /must be used by its named control/, label);
  }
});

test("anonymous default function and class controls can satisfy the gate", async (t) => {
  for (const [label, control] of [
    ["function", "export default function () { return <HeaderIconWrapper />; }"],
    ["class", "export default class { render() { return <HeaderIconWrapper />; } }"],
  ]) {
    const { dir, git } = makeRepo(t);
    const base = commit(git, "base");
    const source = `src/components/Anonymous-${label}.tsx`;
    writeFile(
      dir,
      source,
      `import HeaderIconWrapper from "@/components/PageComponents/Kanban/HeaderComponents/HeaderIconWrapper";\n${control}\n`,
    );
    const head = commit(git, `anonymous ${label}`);
    const body = `## Components reused\n\n${declaration("default", source)}`;

    const result = await evaluate(body, base, head, dir);
    assert.equal(result.pass, true, `${label}: ${result.message}`);
  }
});

test("a specific no-reuse justification supports a genuinely new control", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  const source = "src/components/NewStandalone.tsx";
  writeFile(dir, source, "export const NewStandalone = () => <div />;\n");
  const head = commit(git, "standalone control");
  const reason = "Search found no control with the required interaction";
  const body = `## Components reused\n\n${noReuseDeclaration("NewStandalone", source, reason)}`;

  const result = await evaluate(body, base, head, dir);
  assert.equal(result.pass, true);
  assert.match(result.message, /justified new controls: 1/);
});

test("renamed component destinations require reuse declarations", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/legacy/LegacyControl.tsx", "export const LegacyControl = () => <div />;\n");
  const base = commit(git, "base");
  fs.mkdirSync(path.join(dir, "src/components"), { recursive: true });
  git(["mv", "src/legacy/LegacyControl.tsx", "src/components/LegacyControl.tsx"]);
  const head = commit(git, "move component");

  const result = await evaluate("", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.message, /LegacyControl/);
});

test("JavaScript component files require reuse declarations", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/NewToolbar.js", "export const NewToolbar = () => <div />;\n");
  const head = commit(git, "JavaScript control");

  const result = await evaluate("", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.message, /NewToolbar\.js/);
});

test("co-located tests, stories, and fixtures do not require declarations", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  for (const path of [
    "src/components/Widget.test.tsx",
    "src/components/Widget.spec.jsx",
    "src/components/Widget.stories.tsx",
    "src/components/Widget.fixture.tsx",
    "src/components/fixtures/Widget.tsx",
  ]) {
    writeFile(dir, path, "export const Example = () => <div />;\n");
  }
  const head = commit(git, "component fixtures");

  assert.equal((await evaluate("", base, head, dir)).pass, true);
});
