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

function pinnedMinorLine(range) {
  const pinned = /^~?(\d+)\.(\d+)\.\d+$/.exec(range);
  return pinned ? { major: Number(pinned[1]), minor: Number(pinned[2]) } : null;
}

test("every pinned Better Auth package is ignored above the line it is pinned to", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };

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
  assert.equal(update.groups["stack-minor"].ignore, undefined);
});

test("npm updates wait 7 days so a freshly published worm release is never proposed", async () => {
  const update = await npmRootUpdate();
  assert.ok(update.cooldown?.["default-days"] >= 7, "npm update has no cooldown of at least 7 days (YPER4-596)");
});
