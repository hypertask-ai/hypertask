const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const yaml = require("js-yaml");

const CONFIG_PATH = ".github/dependabot.yml";
const BETTER_AUTH = /^(?:better-auth$|@better-auth\/)/;

async function npmRootUpdate() {
  const config = yaml.load(await readFile(CONFIG_PATH, "utf8"));
  const update = (config.updates ?? []).find(
    (entry) =>
      entry["package-ecosystem"] === "npm" &&
      (entry.directories ?? []).includes("/"),
  );
  assert.ok(update, `${CONFIG_PATH} has no npm entry covering the root manifest`);
  return update;
}

// Exact ("1.6.23") and tilde ("~1.6.26") ranges hold a package on one minor
// line on purpose. A caret range does not, so it is not a pin.
function pinnedMinorLine(range) {
  const pinned = /^~?(\d+)\.(\d+)\.\d+$/.exec(range);
  return pinned ? { major: Number(pinned[1]), minor: Number(pinned[2]) } : null;
}

test("every pinned Better Auth package is ignored above the line it is pinned to", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };

  // The bound is the pinned line's next minor, never the pinned line itself, so
  // patches on the pinned line, security ones included, still arrive.
  const expected = new Map();
  for (const [name, range] of Object.entries(declared)) {
    if (!BETTER_AUTH.test(name)) continue;
    const line = pinnedMinorLine(range);
    if (line) expected.set(name, `>= ${line.major}.${line.minor + 1}.0`);
  }
  assert.ok(expected.size > 0, "no pinned Better Auth package left to check");

  const update = await npmRootUpdate();
  const ignored = new Map(
    (update.ignore ?? [])
      .filter((rule) => BETTER_AUTH.test(rule["dependency-name"]))
      .map((rule) => [rule["dependency-name"], (rule.versions ?? []).join(" ")]),
  );

  // Pinning in package.json does not stop Dependabot proposing the range
  // change. A pinned package with no matching ignore returns in the next
  // grouped PR and fails CI for every healthy update travelling with it.
  assert.deepEqual(ignored, expected);
});

test("the Better Auth ignore sits on the update, not inside the group", async () => {
  const update = await npmRootUpdate();

  assert.ok(
    (update.ignore ?? []).some((rule) =>
      BETTER_AUTH.test(rule["dependency-name"]),
    ),
    "the update entry carries no Better Auth ignore",
  );
  // Nested under `groups`, an ignore would only change how PRs are batched: the
  // bump would come back as its own PR, which dependabot-stack.yml classifies
  // as small and arms auto-merge on.
  assert.equal(update.groups["stack-minor"].ignore, undefined);
});
