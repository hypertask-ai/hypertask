const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const clientDateCallers = [
  "src/hooks/General/useGetTimeOptions.ts",
  "src/lib/constants/InteractiveOnboarding/constants.ts",
  "src/utils/helperFunctions/dateParse.ts",
];

test("client date helpers use Sugar's date-only entry point", () => {
  for (const relativePath of clientDateCallers) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");

    assert.match(source, /from ["']sugar\/date\/create["']/);
    assert.doesNotMatch(source, /from ["']sugar["']/);
    assert.doesNotMatch(source, /Sugar\.Date\.create/);
  }
});

test("the date-only entry point preserves Sugar.Date.create behavior", () => {
  const createDate = require("sugar/date/create");
  const broadCreateDate = require("sugar").Date.create;
  const inputs = ["August 12, 2026 at 9:00 AM", "next Monday at 9:00 AM"];

  for (const input of inputs) {
    assert.equal(createDate(input).toISOString(), broadCreateDate(input).toISOString());
  }
});
