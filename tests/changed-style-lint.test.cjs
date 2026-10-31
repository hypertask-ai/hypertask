const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = path.resolve(__dirname, "../scripts/lint-changed-styles.mjs");
const implementation = import("../scripts/lint-changed-styles.mjs");

function fixture(t) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "changed-style-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  function git(...args) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  function write(file, text) {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), text);
  }
  function commit() {
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  }
  function check(base, head = "") {
    return spawnSync(process.execPath, [script, base, head], { cwd, encoding: "utf8" });
  }
  git("init", "-q");
  return { cwd, git, write, commit, check };
}

test("rejects JSX raw colors and arbitrary typography; accepts named tokens", async () => {
  const { lintStyles } = await implementation;
  for (const value of ["text-[11px]", "leading-[1.5]", "hover:bg-blue-500", "bg-[#333B47]", "text-[rgb(1,2,3)]", "shadow-[0_0_2px_#fff]", "shadow-[#fff_0_0_2px]"]) {
    const findings = lintStyles(`<div className="${value}" />`, "src/Probe.tsx");
    assert.ok(findings.length > 0, value);
    assert.match(findings[0].message, /text-micro.*tailwind.config.ts.*globals.scss/);
  }
  assert.deepEqual(lintStyles('<div className="text-micro text-text-light-gray leading-normal bg-modalBackground" />', "src/Probe.tsx"), []);
});

test("checks conditional classes, templates, and inline typography/color values", async () => {
  const { lintStyles } = await implementation;
  for (const code of [
    '<div className={ok ? "text-[13px]" : "text-content"} />',
    '<div className={`text-content ${active ? "bg-red-500" : "bg-modalBackground"}`} />',
    '<div style={{color: "#333B47", fontSize: 11, lineHeight: "15px"}} />',
  ]) assert.ok(lintStyles(code, "src/Probe.tsx").length > 0, code);
  assert.deepEqual(lintStyles('<div style={{color: "rgb(var(--color-text-light-gray))", fontSize: "var(--font-size)"}} />', "src/Probe.tsx"), []);
});

test("checks CSS and SCSS declarations but permits raw token definitions", async () => {
  const { lintStyles } = await implementation;
  for (const extension of ["css", "scss"]) {
    assert.equal(lintStyles(".probe { color: #123456; font-size: 11px; }", `src/probe.${extension}`).length, 2);
    assert.deepEqual(lintStyles(".probe { color: var(--color-text-light-gray); font-size: var(--font-size); }", `src/probe.${extension}`), []);
  }
  assert.deepEqual(lintStyles(":root { --text: #123456; }", "src/styles/globals.scss"), []);
  assert.equal(lintStyles(":root { --text: #123456; }", "src/components/probe.scss").length, 1);
  assert.equal(lintStyles(".probe { color: #123456; }", "src/styles/globals.scss").length, 1);
  assert.equal(lintStyles(".probe { @apply bg-red-500; }", "src/probe.scss").length, 1);
  assert.deepEqual(lintStyles("// old comment\n.probe { color: rgb(var(--text)); &:hover { @apply text-micro; } }", "src/probe.scss"), []);
});

test("CLI rejects added debt even when unchanged debt is removed; token replacement passes", (t) => {
  const f = fixture(t);
  f.write("src/Probe.tsx", '<div className="bg-red-500" />;\n');
  const base = f.commit();
  f.write("src/Probe.tsx", '<div className="bg-blue-500 text-[11px]" />;\n');
  const failed = f.check(base);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /src\/Probe.tsx:1:.*tailwind.config.ts/);
  f.write("src/Probe.tsx", '<div className="bg-modalBackground text-micro" />;\n');
  assert.equal(f.check(base).status, 0);
  assert.match(f.check(base).stdout, /changed styles ok/);
});

test("CLI allows unchanged debt, deletions, and empty diffs; reads exact head, not workspace", (t) => {
  const f = fixture(t);
  f.write("src/Probe.tsx", '<div className="bg-red-500" />;\nconst value = 1;\n');
  const base = f.commit();
  assert.equal(f.check(base, base).status, 0);
  f.write("src/Probe.tsx", '<div className="bg-red-500" />;\nconst value = 2;\n');
  const head = f.commit();
  f.write("src/Probe.tsx", '<div className="text-[11px]" />;\n');
  assert.equal(f.check(base, head).status, 0);
  assert.equal(f.check(base).status, 1);
  f.git("rm", "-f", "src/Probe.tsx");
  assert.equal(f.check(base).status, 0);
});

test("CLI reports the changed literal line, including multiline CSS values", (t) => {
  const f = fixture(t);
  f.write("README.md", "fixture\n");
  const base = f.commit();
  f.write("src/probe.scss", ".probe {\n  color:\n    #123456;\n}\n");
  const head = f.commit();
  assert.equal(f.check(base, head).status, 1);
  f.write("src/probe.scss", ".probe {\n  color:\n    var(--color-text-light-gray);\n}\n");
  assert.equal(f.check(head).status, 0);
});

test("CLI fails closed for invalid revisions and syntax errors", (t) => {
  const f = fixture(t);
  f.write("README.md", "fixture\n");
  const base = f.commit();
  assert.equal(f.check("missing-revision").status, 1);
  f.write("src/Probe.tsx", "<div broken={ />");
  const head = f.commit();
  assert.equal(f.check(base, head).status, 1);
});


test("historical PR 2006 typography is refused and its named-token replacement passes", async () => {
  const { lintStyles } = await implementation;
  const source = '<TableTicketCell ticket={task.ticketNumber || `#${task.uniqueIndex}`} className="overflow-hidden text-ellipsis text-[11px]" />';
  assert.equal(lintStyles(source, "src/components/AI_CHAT/AiChatTicketRows.tsx").length, 1);
  assert.deepEqual(lintStyles(source.replace("text-[11px]", "text-micro"), "src/components/AI_CHAT/AiChatTicketRows.tsx"), []);
});

test("required CI invokes the real command on exact PR commits, without a new job", () => {
  const yaml = require("js-yaml");
  const root = path.resolve(__dirname, "..");
  const workflow = yaml.load(readFileSync(path.join(root, ".github/workflows/ci-tests.yml"), "utf8"));
  const launcher = workflow.jobs["ci-checks"].steps.find((entry) => entry.name === "Run independent static checks");
  assert.equal(launcher.if, "needs.ci-prepare.outputs.run_tests == 'true' || needs.ci-prepare.outputs.boundary_needed == 'true'");
  assert.equal(workflow.jobs["ci-checks"].steps.find((entry) => entry.uses?.startsWith("actions/checkout@")).with["fetch-depth"], 0);
  assert.equal(launcher.env.BASE_SHA, "${{ github.event.pull_request.base.sha }}");
  assert.equal(launcher.env.HEAD_SHA, "${{ github.event.pull_request.head.sha }}");
  const lane = launcher.run.match(/lane_changed_style_tokens\(\) \{[\s\S]*?\n *\}/)?.[0];
  assert.ok(lane, "changed style tokens is a lane of the static gates");
  assert.ok(lane.includes('npm run lint:styles -- "$BASE_SHA" "$HEAD_SHA"'));
  assert.ok(!workflow.jobs["ci-checks"].steps.some((entry) => String(entry.name ?? "").includes("Changed style tokens")));
  assert.equal(Object.values(workflow.jobs).filter((job) => JSON.stringify(job).includes("lint:styles")).length, 1);
  assert.equal(require("../package.json").scripts["lint:styles"], "node scripts/lint-changed-styles.mjs");
});


test("resolves const classes and styles without looping on cyclic references", async () => {
  const { lintStyles } = await implementation;
  assert.equal(lintStyles('const cls = "text-[11px]"; <div className={cls} />', "src/Probe.tsx").length, 1);
  assert.equal(lintStyles('const style = {fontSize: "11px"}; <div style={style} />', "src/Probe.tsx").length, 1);
  assert.deepEqual(lintStyles('const cls = "text-micro"; <div className={cls} />', "src/Probe.tsx"), []);
  assert.deepEqual(lintStyles('const cls = cls; <div className={cls} />', "src/Probe.tsx"), []);
});

test("adding a comment beside unchanged multiline CSS debt passes", (t) => {
  const f = fixture(t);
  f.write("src/probe.scss", ".probe {\n  color:\n    #123456;\n}\n");
  const base = f.commit();
  f.write("src/probe.scss", ".probe {\n  color: /* clarification */\n    #123456;\n}\n");
  assert.equal(f.check(base).status, 0);
  f.write("src/probe.scss", ".probe {\n  color: /* clarification */\n    #654321;\n}\n");
  assert.equal(f.check(base).status, 1);
});


test("member access checks only the selected static property", async () => {
  const { lintStyles } = await implementation;
  const source = 'const styles = {label: "text-content", raw: "text-[11px]", unrelated: "#123456"}; <div className={styles.label} />';
  assert.deepEqual(lintStyles(source, "src/Probe.tsx"), []);
  assert.equal(lintStyles(source.replace("styles.label", 'styles["raw"]'), "src/Probe.tsx").length, 1);
  for (const assertion of ["as const", "satisfies Record<string, string>"]) {
    const asserted = source.replace("};", `} ${assertion};`);
    assert.deepEqual(lintStyles(asserted, "src/Probe.tsx"), []);
    assert.equal(lintStyles(asserted.replace("styles.label", "styles.raw"), "src/Probe.tsx").length, 1);
  }
});


test("merge-base comparison ignores production-only tokenization", (t) => {
  const f = fixture(t);
  f.write("src/Probe.tsx", '<div className="bg-red-500" />;\n');
  const fork = f.commit();
  f.write("src/Probe.tsx", '<div className="bg-modalBackground" />;\n');
  const base = f.commit();
  f.git("switch", "-qc", "feature", fork);
  f.write("README.md", "unrelated feature change\n");
  assert.equal(f.check(base, f.commit()).status, 0);
  f.write("src/Probe.tsx", '<div className="bg-blue-500" />;\n');
  assert.equal(f.check(base, f.commit()).status, 1);
});

test("CSS strings and URL fragments are not colors; real literal colors still fail", async () => {
  const { lintStyles } = await implementation;
  assert.deepEqual(lintStyles('.probe {content: "#123"; background-image: url("/icons.svg#face");}', "src/probe.scss"), []);
  assert.deepEqual(lintStyles('<div style={{backgroundImage: `url("/icons.svg#face")`}} />', "src/Probe.tsx"), []);
  assert.deepEqual(lintStyles('<div className="bg-[url(/icons.svg#face)]" />', "src/Probe.tsx"), []);
  assert.equal(lintStyles('.probe {color: #fff!important;}', "src/probe.scss").length, 1);
  assert.deepEqual(lintStyles('.probe {@apply /* text-[11px] */ text-micro;}', "src/probe.scss"), []);
});

test("new consumption of an unchanged raw constant is refused", (t) => {
  const f = fixture(t);
  const source = 'const raw = "text-[11px]";\nconst valid = "text-micro";\n<div className={valid} />;\n';
  f.write("src/Probe.tsx", source);
  const base = f.commit();
  f.write("src/Probe.tsx", source.replace("className={valid}", "className={raw}"));
  assert.equal(f.check(base).status, 1);
  f.write("src/Probe.tsx", source);
  assert.equal(f.check(base).status, 0);
});

test("class-map keys are inspected without treating CSS property names as classes", async () => {
  const { lintStyles } = await implementation;
  assert.ok(lintStyles('<div className={clsx({"text-[11px]": active})} />', "src/Probe.tsx").length > 0);
  assert.deepEqual(lintStyles('<div className={clsx({"text-micro": active})} />', "src/Probe.tsx"), []);
  assert.deepEqual(lintStyles('<div style={{color: "var(--text)"}} />', "src/Probe.tsx"), []);
});
