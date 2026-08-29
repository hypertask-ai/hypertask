const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const z = require("zod");

const routeSource = fs.readFileSync(
  path.join(__dirname, "../src/app/api/ai/chat/stream/route.ts"),
  "utf8"
);

function loadErrorFormatters(logs = []) {
  const start = routeSource.indexOf("function errorMessage");
  assert.notEqual(start, -1, "errorMessage must exist in the chat route");
  const end = routeSource.indexOf("async function reportHandledChatError", start);
  assert.notEqual(end, -1, "reportHandledChatError must follow the formatters");

  const javascript = ts.transpileModule(routeSource.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const logger = { error: (...args) => logs.push(args) };
  return new Function(
    "console",
    "z",
    `${javascript}; return { errorMessage, userFacingErrorMessage, requestErrorMessage };`
  )(logger, z);
}

function loadChatRequestSchema() {
  const start = routeSource.indexOf("const attachmentSchema");
  assert.notEqual(start, -1, "attachmentSchema must exist in the chat route");
  const end = routeSource.indexOf("type ChatRequest", start);
  assert.notEqual(end, -1, "ChatRequest must follow the request schema");

  const javascript = ts.transpileModule(routeSource.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function("z", `${javascript}; return chatRequestSchema;`)(z);
}

test("LangChain-style streaming errors are replaced with safe retry copy", () => {
  const { userFacingErrorMessage } = loadErrorFormatters();
  const error = new Error(
    "Error during hybrid streaming: Recursion limit of 25 reached. See https://python.langchain.com/docs/troubleshooting/errors/GRAPH_RECURSION_LIMIT"
  );

  const message = userFacingErrorMessage(error, "model-stream");

  assert.equal(
    message,
    "Sorry, something went wrong while generating a response. Please try again."
  );
  assert.doesNotMatch(message, /https?:\/\//i);
  assert.doesNotMatch(message, /hybrid|recursion|langchain/i);
  assert.equal(message.includes(error.message), false);
});

test("provider errors do not leak their message or internal identifier", () => {
  const { userFacingErrorMessage } = loadErrorFormatters();
  const error = new Error(
    "Anthropic overloaded_error for request req_01InternalIdentifier"
  );

  const message = userFacingErrorMessage(error, "model-stream");

  assert.equal(message.includes(error.message), false);
  assert.doesNotMatch(message, /anthropic|overloaded|req_01InternalIdentifier/i);
});

test("application errors also use generic copy without a typed safe distinction", () => {
  const { userFacingErrorMessage } = loadErrorFormatters();
  const error = new Error("You do not have access to that board");

  const message = userFacingErrorMessage(error, "stream-handler");

  assert.equal(message.includes(error.message), false);
  assert.match(message, /Please try again\./);
});

test("included allowance exhaustion keeps its safe recovery message", () => {
  const { userFacingErrorMessage } = loadErrorFormatters();
  const inner = new Error(
    "This team has used its included AI allowance for this month. Upgrade or add your own AI key to continue.",
  );
  inner.name = "SharedAiAllowanceExceededError";
  const wrapped = new Error("AI request failed", { cause: inner });

  assert.equal(userFacingErrorMessage(wrapped, "model-stream"), inner.message);
});

test("user-facing formatting logs the full error with its stage", () => {
  const logs = [];
  const { userFacingErrorMessage } = loadErrorFormatters(logs);
  const error = new Error("Provider response with debugging detail");

  userFacingErrorMessage(error, "model-stream");

  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /model-stream/);
  assert.equal(logs[0][1], error);
});

test("model-facing errorMessage still returns non-Prisma errors verbatim", () => {
  const { errorMessage } = loadErrorFormatters();
  const message = "You do not have access to that board";

  assert.equal(errorMessage(new Error(message)), message);
});

test("request validation names an empty message without leaking Zod detail", () => {
  const logs = [];
  const { requestErrorMessage } = loadErrorFormatters(logs);
  const result = loadChatRequestSchema().safeParse({ message: "" });
  assert.equal(result.success, false);

  const message = requestErrorMessage(result.error, "validation");

  assert.equal(message, "Invalid request: message is required.");
  assert.doesNotMatch(message, /\[|code|origin/);
  assert.equal(message.includes("\n"), false);
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /request-validation user-facing error/);
  assert.equal(logs[0][1], result.error);
});

test("malformed JSON uses its own plain request-body message", () => {
  const logs = [];
  const { requestErrorMessage } = loadErrorFormatters(logs);
  const error = new SyntaxError("Unexpected end of JSON input");

  const message = requestErrorMessage(error, "body");

  assert.equal(
    message,
    "Invalid request: the request body could not be read."
  );
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /request-body user-facing error/);
  assert.equal(logs[0][1], error);
  assert.match(
    routeSource,
    /try \{\s*json = await request\.json\(\);\s*\} catch \(error\) \{\s*return createSseErrorResponse\(requestErrorMessage\(error, "body"\)\);\s*\}/
  );
});

test("validation without a field path falls back to a plain request message", () => {
  const { requestErrorMessage } = loadErrorFormatters();
  const rootResult = loadChatRequestSchema().safeParse([]);
  assert.equal(rootResult.success, false);

  assert.equal(
    requestErrorMessage(rootResult.error, "validation"),
    "Invalid request."
  );
  assert.equal(
    requestErrorMessage(new z.ZodError([]), "validation"),
    "Invalid request."
  );
});

test("model-selection errors remain user-actionable and pass through unchanged", () => {
  assert.match(
    routeSource,
    /catch \(error\) \{\s*await reportHandledChatError\(error, "select-model"\);\s*return createSseErrorResponse\(errorMessage\(error\)\);\s*\}/
  );
});

test("expected plan-access guidance is not reported as a product bug", () => {
  assert.match(
    routeSource,
    /if \(error instanceof Error && error\.name === "AiPlanAccessError"\) return;/
  );

  const planGateSource = fs.readFileSync(
    path.join(__dirname, "../src/app/api/ai/_lib/planGate.ts"),
    "utf8"
  );
  assert.match(planGateSource, /export class AiPlanAccessError extends Error/);
  assert.equal(
    (planGateSource.match(/throw new AiPlanAccessError/g) || []).length,
    3
  );
});

test('no send("error") call site uses model-facing errorMessage', () => {
  assert.equal((routeSource.match(/send\("error"/g) || []).length, 2);
  assert.doesNotMatch(
    routeSource,
    /send\("error",\s*\{\s*content:\s*errorMessage\(/
  );
  assert.equal(
    (
      routeSource.match(
        /send\("error",\s*\{\s*content:\s*userFacingErrorMessage\(/g
      ) || []
    ).length,
    2
  );
});

test("board agent instructions never let the model answer as the agent after a failed hypertask_ask_agent call", () => {
  const start = routeSource.indexOf("### 4.3. BOARD AGENTS");
  const end = routeSource.indexOf("### 5. METADATA FILTERING LOGIC", start);
  assert.notEqual(start, -1, "BOARD AGENTS system prompt section must exist");
  assert.notEqual(end, -1, "METADATA FILTERING LOGIC section must follow it");
  const section = routeSource.slice(start, end);

  // The synthesize-and-attribute instruction only fires on success; a
  // generic "success: false" guard (not a list of the tool's specific error
  // strings) keeps this correct even if new failure branches are added.
  assert.match(section, /returns success: true, synthesize/);
  assert.match(section, /returns success: false/);
  assert.match(section, /do not answer the question from your own general knowledge/i);
  assert.match(section, /never present your own knowledge as if it came from the agent/i);

  // The failure message must stay user-safe: the model is told to describe
  // the failure in its own words, never to quote the tool's raw error text
  // (which would cross the model-facing vs user-facing error boundary this
  // file otherwise maintains via errorMessage()/userFacingErrorMessage()).
  assert.match(section, /do not quote the tool's raw error text/i);
});
