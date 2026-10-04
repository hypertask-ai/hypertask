const assert = require("node:assert/strict");
const test = require("node:test");
const minimatch = require("minimatch");
const { lintPathPattern } = require("./htpr-6509-s3-verify.cjs");

test("lint path patterns match route brackets literally", () => {
  const file = "src/app/api/pages/[publicId]/route.ts";
  const pattern = lintPathPattern(file).slice(1);
  assert.ok(minimatch(file, pattern));
  assert.ok(!minimatch("src/app/api/pages/p/route.ts", pattern));
});

for (const file of ["tests/fixture\\name[1].test.cjs", "tests/fixture\\\\[1].test.cjs"]) {
  test(`lint path patterns escape literal backslashes: ${JSON.stringify(file)}`, () => {
    const pattern = lintPathPattern(file).slice(1);
    assert.ok(minimatch(file, pattern));
    assert.ok(!minimatch(file.replaceAll("\\", ""), pattern));
    assert.ok(!minimatch(file.replace("[1]", "1"), pattern));
  });
}
