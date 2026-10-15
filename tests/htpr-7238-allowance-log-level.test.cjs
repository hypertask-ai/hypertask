const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(__dirname, "..", "src") },
});
const { userFacingErrorMessage } = jiti(
  path.join(__dirname, "../src/lib/ai/chatStream/errors.ts"),
);
const { SharedAiAllowanceExceededError } = jiti(
  path.join(__dirname, "../src/app/api/ai/_lib/sharedAllowance.ts"),
);

function captureConsole(run) {
  const calls = { error: [], warn: [], info: [] };
  const original = {};
  for (const level of Object.keys(calls)) {
    original[level] = console[level];
    console[level] = (...args) => calls[level].push(args);
  }
  try {
    return { result: run(), calls };
  } finally {
    Object.assign(console, original);
  }
}

test("a used-up AI allowance is logged as info, not as an error", () => {
  const allowance = new SharedAiAllowanceExceededError("2026-10");
  const wrapped = new Error("model call failed", { cause: allowance });

  const { result, calls } = captureConsole(() =>
    userFacingErrorMessage(wrapped, "model-stream"),
  );

  assert.equal(result, allowance.message);
  assert.equal(calls.error.length, 0);
  assert.equal(calls.warn.length, 0);
  assert.deepEqual(calls.info, [
    ["[ai/chat/stream] model-stream refused: included AI allowance used up"],
  ]);
  assert.doesNotMatch(JSON.stringify(calls.info), /2026-10/);
});

test("a real model failure is still logged as an error", () => {
  const failure = new Error("Anthropic overloaded_error");

  const { result, calls } = captureConsole(() =>
    userFacingErrorMessage(failure, "model-stream"),
  );

  assert.equal(
    result,
    "Sorry, something went wrong while generating a response. Please try again.",
  );
  assert.equal(calls.error.length, 1);
  assert.equal(calls.error[0][0], "[ai/chat/stream] model-stream user-facing error");
  assert.equal(calls.error[0][1], failure);
});
