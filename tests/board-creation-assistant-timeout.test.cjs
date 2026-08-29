const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src/components/Modals/BoardCreationAssistant/index.tsx",
  ),
  "utf8",
);
const routeSource = fs.readFileSync(
  path.join(__dirname, "..", "src/app/api/ai/generate-board/route.ts"),
  "utf8",
);

test("signed-in board generation times out instead of hanging forever", () => {
  assert.match(
    source,
    /fetch\("\/api\/ai\/generate-board",\s*\{[\s\S]*?signal:\s*AbortSignal\.timeout\(45000\)/,
  );
});

test("board generation retries reuse one idempotent server operation", () => {
  assert.match(source, /pendingRequest\?\.prompt === trimmed/);
  assert.match(source, /"Idempotency-Key": idempotencyKey/);
  assert.match(routeSource, /withIdempotency\(\s*"generate_onboarding_board"/);
  assert.match(routeSource, /abortSignal: request\.signal/);
  assert.match(routeSource, /request\.signal\.throwIfAborted\(\)/);
});
