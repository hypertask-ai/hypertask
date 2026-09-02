const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "../src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo.tsx",
  ),
  "utf8",
);

test("the pull request property keeps its label and fits the mobile rail", () => {
  assert.match(
    source,
    /<TaskInfoLabel>Pull requests<\/TaskInfoLabel>/,
  );
  assert.match(
    source,
    /<TaskInfoValue className="flex min-w-0 flex-col gap-1 overflow-hidden">/,
  );
  assert.match(
    source,
    /className="flex w-full max-w-full min-w-0 items-center gap-1\.5 overflow-hidden py-0\.5"/,
  );
  assert.match(
    source,
    /className="min-w-0 flex-1 truncate text-white-black hover:underline"/,
  );
});
