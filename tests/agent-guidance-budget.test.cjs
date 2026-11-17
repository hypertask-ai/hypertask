const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("each repository startup rules file stays below 5 KB", () => {
  for (const file of ["AGENTS.md", "CLAUDE.md"]) {
    const contents = fs.readFileSync(path.join(root, file));
    assert.ok(contents.length < 5000, `${file}: ${contents.length} bytes`);
  }
});

test("Claude imports the same agent map without a second rule copy", () => {
  assert.equal(
    fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8").trim(),
    "@AGENTS.md",
  );
});

test("the startup map reaches existing reference files and headings", () => {
  const map = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const links = [...map.matchAll(/\]\(([^)]+)\)/g)];
  assert.ok(links.length > 0);
  for (const [, target] of links) {
    const [file, anchor] = target.split("#");
    const contents = fs.readFileSync(path.join(root, file), "utf8");
    if (anchor) {
      const headings = [...contents.matchAll(/^#+ (.+)$/gm)].map(([, heading]) =>
        heading.toLowerCase().replace(/[^\w -]/g, "").replaceAll(" ", "-"),
      );
      assert.ok(headings.includes(anchor), `Missing heading: ${target}`);
    }
  }
});

test("the every-ticket shipping guide stays under its reading budget", () => {
  const guide = "skills/ship/SKILL.md";
  const contents = fs.readFileSync(path.join(root, ".claude", guide));
  assert.ok(
    contents.length < 17000,
    `${guide}: ${contents.length} bytes. Move occasional operations into .claude/reference/ship-operations.md or flags.md instead of adding prose to the step guide.`,
  );
});

test("every guide the shipping skill links to still resolves", () => {
  const guide = path.join(root, ".claude/skills/ship/SKILL.md");
  const links = [...fs.readFileSync(guide, "utf8").matchAll(/\]\(([^)#]+)(?:#([^)]+))?\)/g)];
  assert.ok(links.length > 0);
  for (const [, target, anchor] of links) {
    const resolved = path.resolve(path.dirname(guide), target);
    assert.ok(fs.existsSync(resolved), `Missing path: ${target}`);
    if (!anchor || fs.statSync(resolved).isDirectory()) continue;
    const contents = fs.readFileSync(resolved, "utf8");
    const headings = [...contents.matchAll(/^#+ (.+)$/gm)].map(([, heading]) =>
      heading.toLowerCase().replace(/[^\w -]/g, "").replaceAll(" ", "-"),
    );
    assert.ok(headings.includes(anchor), `Missing heading: ${target}#${anchor}`);
  }
});

test("the startup map agrees with the retained emergency flag rule", () => {
  const map = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const flags = fs.readFileSync(path.join(root, ".claude/reference/flags.md"), "utf8");
  assert.ok(flags.includes("Runners never switch a flag Off"));
  assert.ok(/Owner \+ QA/.test(map), "map must name the emergency mode");
  assert.ok(!/switch Off immediately/i.test(map), "map must not contradict the retained rule");
});
