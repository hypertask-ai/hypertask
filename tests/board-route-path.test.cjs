const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
    })
  : jitiModule(__filename, { interopDefault: true, cache: false });
const { buildCanonicalBoardUrl, resolveBoardRoutePath } = jiti(
  path.join(root, "src/lib/boardRoutePath.ts"),
);

test("keeps the canonical project route eligible for board fallback", () => {
  assert.deepEqual(resolveBoardRoutePath(["project"]), { kind: "canonical" });
});

test("retains a path-form board id instead of silently selecting a default board", () => {
  assert.deepEqual(resolveBoardRoutePath(["project-15"]), {
    kind: "redirect",
    projectId: "15",
  });
  assert.deepEqual(resolveBoardRoutePath(["project-99999999"]), {
    kind: "redirect",
    projectId: "99999999",
  });
});

test("rejects unrelated and malformed catch-all paths", () => {
  for (const boardURL of [
    ["unknown"],
    ["project-nope"],
    ["project-0"],
    ["project", "extra"],
    [],
    undefined,
  ]) {
    assert.deepEqual(resolveBoardRoutePath(boardURL), { kind: "not-found" });
  }
});

test("builds the canonical board URL without dropping query parameters", () => {
  assert.equal(
    buildCanonicalBoardUrl("15", {
      id: "999",
      view: "bugs",
      label: ["one", "two"],
      empty: undefined,
    }),
    "/project?id=15&view=bugs&label=one&label=two",
  );
});

test("the catch-all page resolves its path before reading board cookies", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/[...boardURL]/page.tsx"),
    "utf8",
  );
  const resolution = source.indexOf("const pathResolution = resolveBoardRoutePath(");
  const cookies = source.indexOf("const cookieStore = await cookies();", resolution);

  assert.notEqual(resolution, -1);
  assert.notEqual(cookies, -1);
  assert.ok(resolution < cookies);
  assert.match(source, /pathResolution\.kind === "not-found"[^]*notFound\(\)/);
  assert.match(source, /pathResolution\.kind === "redirect"[^]*redirect\(/);
});
