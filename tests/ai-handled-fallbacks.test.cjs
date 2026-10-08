const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filename) : [filename];
  });
}

function parse(filename, text = fs.readFileSync(filename, "utf8")) {
  return ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
}

function nodesWithin(node, predicate, shallow = true) {
  const found = [];
  function visit(current) {
    if (predicate(current)) found.push(current);
    if (shallow && current !== node && (ts.isFunctionLike(current) || ts.isCatchClause(current))) return;
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function isClientResponse(expression) {
  if (!ts.isCallExpression(expression)) return false;
  const name = expression.expression.getText();
  let status;
  if (name === "createSseErrorResponse") {
    status = expression.arguments[1];
    const message = expression.arguments[0];
    if (message && ts.isCallExpression(message) && message.expression.getText() === "requestErrorMessage") return true;
  } else if (ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "json") {
    const guard = expression.parent.parent.parent;
    // Missing SDK output is an expected empty-question result, not an incident.
    if (ts.isIfStatement(guard) && guard.thenStatement === expression.parent.parent &&
      expression.arguments[0]?.getText().replace(/\s+/g, "") === "{questions:[]}" &&
      guard.expression.getText().replace(/\s+/g, "") ===
        "NoOutputGeneratedError.isInstance(error)||(NoObjectGeneratedError.isInstance(error)&&!error.text?.trim())") return true;
    const options = expression.arguments[1];
    if (options && ts.isObjectLiteralExpression(options)) {
      status = options.properties.find((property) =>
        ts.isPropertyAssignment(property) && property.name.getText() === "status",
      )?.initializer;
    }
    const receiver = expression.expression.expression;
    if (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression) && receiver.expression.name.text === "status") {
      status = receiver.arguments[0];
    }
  }
  if (status && ts.isNumericLiteral(status)) {
    if (Number(status.text) >= 400 && Number(status.text) < 500) return true;
    // Board memory deliberately returns Retry-After while another refresh owns its lock.
    return status.text === "503" &&
      expression.parent.parent.parent.getText().startsWith("if (error instanceof BoardMemoryBusyError)");
  }
  // generate-board only converts typed request errors; the test checks their statuses.
  return status?.getText() === "error.status" &&
    expression.parent.parent.parent.getText().startsWith("if (error instanceof BoardGenerationRequestError)");
}

function isFallback(block) {
  const returns = nodesWithin(block, ts.isReturnStatement);
  if (returns.some((node) => node.expression && !isClientResponse(node.expression))) return true;
  if (nodesWithin(block, ts.isBinaryExpression).some((node) =>
    /Unavailable$|Fallback$/.test(node.left.getText()) && node.right.kind === ts.SyntaxKind.TrueKeyword,
  )) return true;
  return nodesWithin(block, ts.isCallExpression).some((node) => {
    const text = node.getText();
    return /^(enqueueError|fail)\(/.test(text) ||
      /\.enqueue\([\s\S]*event: error/.test(text) ||
      /console\.error\([\s\S]*unavailable/.test(text);
  });
}

function reportsHandledError(block) {
  return block.statements.some((statement, index) => {
    if (block.statements.slice(0, index).some(isFallback)) return false;
    if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression)) return false;
    const call = ts.isAwaitExpression(statement.expression)
      ? statement.expression.expression
      : statement.expression;
    if (!ts.isCallExpression(call)) return false;
    // Existing chat reporter already delegates to reportError with source: handled.
    if (call.expression.getText() === "reportHandledChatError") return true;
    return call.expression.getText() === "reportError" &&
      call.arguments.length === 1 &&
      ts.isObjectLiteralExpression(call.arguments[0]) &&
      call.arguments[0].properties.some((property) =>
        ts.isPropertyAssignment(property) && property.name.getText() === "source" &&
        ts.isStringLiteral(property.initializer) && property.initializer.text === "handled",
      );
  });
}

function missingReports(source) {
  const missing = [];
  function visit(node) {
    if (ts.isCatchClause(node) && isFallback(node.block) && !reportsHandledError(node.block)) {
      missing.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return missing;
}

const files = [
  ...walk(path.join(root, "src/app/api/ai")),
  ...walk(path.join(root, "src/app/api/mcp/ai")),
  ...walk(path.join(root, "src/app/api/demo/chat")),
].filter((filename) => filename.endsWith("/route.ts"));
files.push(...walk(path.join(root, "src/pages/api/ai")).filter((filename) => filename.endsWith(".ts")));

test("all AI route fallback catches report handled errors", () => {
  const missing = files.flatMap((filename) =>
    missingReports(parse(filename)).map((line) => `${path.relative(root, filename)}:${line}`),
  );
  assert.deepEqual(missing, [], "Unhandled fallback catches");
});

test("only the typed missing-output branch may skip empty-question incident reporting", () => {
  const condition = "NoOutputGeneratedError.isInstance(error) || (NoObjectGeneratedError.isInstance(error) && !error.text?.trim())";
  const response = "return NextResponse.json({ questions: [] });";
  assert.deepEqual(missingReports(parse("fixture.ts", `try {} catch (error) { if (${condition}) { ${response} } await reportError({ source: "handled" }); return []; }`)), []);
  for (const body of [
    `if (${condition}) { ${response} } return [];`,
    `if (NoObjectGeneratedError.isInstance(error)) { ${response} } await reportError({ source: "handled" }); return [];`,
    `if (true) { ${response} } await reportError({ source: "handled" }); return [];`,
    `if (${condition}) {} else { ${response} } await reportError({ source: "handled" }); return [];`,
  ]) {
    assert.equal(missingReports(parse("fixture.ts", `try {} catch (error) { ${body} }`)).length, 1);
  }
});

test("AI route catches never report the same error twice", () => {
  function duplicates(source) {
    const lines = [];
    function visit(node) {
      if (ts.isCatchClause(node)) {
        const calls = nodesWithin(node.block, ts.isCallExpression).filter((call) =>
          ["reportError", "reportHandledChatError"].includes(call.expression.getText()),
        );
        if (calls.length > 1) lines.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    return lines;
  }
  const fixture = parse("fixture.ts", 'try {} catch (error) { await reportError({ source: "handled" }); await reportError({ source: "server" }); return []; }');
  assert.equal(duplicates(fixture).length, 1, "The audit must detect duplicate reports");
  const nested = parse("fixture.ts", 'try {} catch (error) { await reportError({ source: "handled" }); try {} catch (inner) { await reportError({ source: "handled" }); } }');
  assert.deepEqual(duplicates(nested), [], "Separate nested catches are not duplicates");
  assert.deepEqual(files.flatMap((filename) =>
    duplicates(parse(filename)).map((line) => `${path.relative(root, filename)}:${line}`),
  ), []);
});

test("coverage detects generic, empty, streaming and nested fallbacks, not just known copy", () => {
  for (const fallback of [
    'return NextResponse.json({ error: "New friendly wording" }, { status: 500 });',
    'return NextResponse.json({ questions: [] });',
    'return [];',
    'mentionModelUnavailable = true; selected = await selectModel(true);',
    'return NextResponse.json({ error: "status: 400" }, { status: 500 });',
    'enqueueError("error", errorMessage(error));',
    'controller.enqueue(encoder.encode(`event: error\\ndata: ${errorMessage(error)}`));',
    'fail(error);',
    'if (error instanceof PermissionError) return NextResponse.json({}, { status: 403 }); return NextResponse.json({}, { status: 500 });',
  ]) {
    assert.equal(missingReports(parse("fixture.ts", `try {} catch (error) { ${fallback} }`)).length, 1);
  }
  const nested = parse("fixture.ts", 'try {} catch (error) { try {} catch (inner) { await reportError({ source: "handled" }); return []; } return []; }');
  assert.equal(missingReports(nested).length, 1, "An inner report must not cover its outer catch");
  const conditional = parse("fixture.ts", 'try {} catch (error) { if (false) await reportError({ source: "handled" }); return []; }');
  assert.equal(missingReports(conditional).length, 1, "Conditional reporting must not hide a fallback");
  for (const body of ['return []; await reportError({ source: "handled" });', 'reportError({ source: "handled" }); return [];']) {
    assert.equal(missingReports(parse("fixture.ts", `try {} catch (error) { ${body} }`)).length, 1, "Reporting must be awaited before the fallback");
  }
});

test("coverage permits expected client responses and rethrows but rejects wrong report sources", () => {
  for (const body of [
    'return NextResponse.json({ error: "Invalid request" }, { status: 400 });',
    'return createSseErrorResponse(requestErrorMessage(error, "body"));',
    'throw error;',
    'await reportError({ source: "handled" }); return [];',
    'await reportHandledChatError(error, "load-user"); return createSseErrorResponse(errorMessage(error));',
  ]) {
    assert.deepEqual(missingReports(parse("fixture.ts", `try {} catch (error) { ${body} }`)), []);
  }
  assert.equal(missingReports(parse("fixture.ts", 'try {} catch (error) { await reportError({ source: "server" }); return []; }')).length, 1);
  const chatReporter = fs.readFileSync(path.join(root, "src/lib/ai/chatStream/errors.ts"), "utf8");
  assert.match(chatReporter, /await reportError\(\{[\s\S]*?source: "handled"/);
  const boardRoute = parse(path.join(root, "src/app/api/ai/generate-board/route.ts"));
  for (const call of nodesWithin(boardRoute, ts.isNewExpression, false)) {
    if (call.expression.getText() === "BoardGenerationRequestError") {
      const status = Number(call.arguments[0].getText());
      assert.ok(status >= 400 && status < 500, "Only client errors may bypass reporting");
    }
  }
});

test("new report payloads use only error diagnostics and literal route/stage metadata", () => {
  let reports = 0;
  for (const filename of files) {
    const source = parse(filename);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText() === "reportError") {
        const payload = node.arguments[0];
        assert.ok(ts.isObjectLiteralExpression(payload));
        const properties = Object.fromEntries(payload.properties.map((property) => {
          assert.ok(ts.isPropertyAssignment(property), "No payload spreads or shorthand error objects");
          return [property.name.getText(), property.initializer.getText()];
        }));
        assert.deepEqual(Object.keys(properties).sort(), ["extra", "message", "source", "stack", "url"]);
        assert.equal(properties.source, '"handled"');
        assert.match(properties.url, /^"\/api\/[a-zA-Z/\[\]-]+"$/);
        assert.match(properties.extra, /^\{ stage: "[a-z-]+" \}$/);
        assert.match(properties.message, /^error instanceof Error \? error\.message : "[^"]+"$/);
        assert.equal(properties.stack, "error instanceof Error ? error.stack : undefined");
        reports += 1;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.ok(reports > 0, "The payload audit must inspect real reporting calls");
});

function loadRoute(relativePath, stubs) {
  const filename = path.join(root, relativePath);
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const routeModule = { exports: {} };
  require("node:vm").runInNewContext(javascript, {
    module: routeModule,
    exports: routeModule.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(stubs, name), `Missing stub for ${name}`);
      return stubs[name];
    },
    console: { error() {} },
    Error,
    Response,
    ReadableStream,
    TextEncoder,
  }, { filename });
  return routeModule.exports;
}

function routeStubs(error, reports) {
  return {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "ai": { generateText: async () => { throw error; } },
    "@/lib/errors/reportError": { reportError: async (payload) => reports.push(payload) },
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => ({ id: 7 }) },
    "@/app/api/ai/_lib/aiUsage": {},
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {} },
    "@/app/api/ai/_lib/editorAi": {
      errorMessage: (value) => value instanceof Error ? value.message : "Sorry, an error occurred while processing your request.",
      getCurrentUserFromCookies: async () => ({ id: 7 }),
      extractHtmlBlocks: (content) => ({ stripped: content, blocks: [] }),
      selectTiptapModel: async () => ({ model: {} }),
      createPromptForTiptapForwardSlash: () => "private prompt",
      sseFrame: (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      SSE_HEADERS: { "Content-Type": "text/event-stream" },
    },
    "@/app/api/ai/_lib/taskWriterRun": {
      taskWriterRequestSchema: { parse: (body) => body },
      missingRequiredFields: () => false,
      prepareTaskWriterRun: async () => { throw error; },
      AiFeatureDisabledError: class extends Error {},
      AutoDescriptionSuggestionsDisabledError: class extends Error {},
      ProjectAccessError: class extends Error {},
    },
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/app/api/ai/_lib/currentTaskContext": { resolveAiUsageTaskId: async () => null },
    "@/lib/prisma": { default: {} },
    "./requestSchema": { tiptapForwardSlashRequestSchema: { safeParse: (data) => ({ success: true, data }) } },
  };
}

function assertSafeReport(report, error, url) {
  assert.equal(report.source, "handled");
  assert.equal(report.url, url);
  assert.equal(report.message, error instanceof Error ? error.message : "AI request failed");
  assert.equal(report.stack, error instanceof Error ? error.stack : undefined);
  assert.deepEqual(Object.keys(report.extra), ["stage"]);
  assert.doesNotMatch(JSON.stringify(report), /private prompt|private reply|requestBodyValues|responseBody/);
}

test("Task Writer and Improve with AI keep their 500 responses and report without provider bodies", async () => {
  for (const error of [
    Object.assign(new Error("Provider unavailable"), { requestBodyValues: { prompt: "private prompt" }, responseBody: "private reply" }),
    { requestBodyValues: { prompt: "private prompt" }, responseBody: "private reply" },
  ]) {
    for (const routeName of ["task-writer", "tiptap-forwardslash"]) {
      const reports = [];
      const { POST } = loadRoute(`src/app/api/ai/${routeName}/route.ts`, routeStubs(error, reports));
      const response = await POST({ json: async () => ({ content: "private prompt", command: "ImproveReadability" }) });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: routeName === "task-writer"
          ? (error instanceof Error ? error.message : "Sorry, an error occurred while processing your request.")
          : "An internal error occurred. Please try again later.",
      });
      assert.equal(reports.length, 1);
      assertSafeReport(reports[0], error, `/api/ai/${routeName}`);
    }
  }
});

test("Task Writer streaming failures still emit the same error and done frames", async () => {
  const error = Object.assign(new Error("Provider unavailable"), { responseBody: "private reply" });
  const reports = [];
  const stubs = routeStubs(error, reports);
  stubs["@/app/api/ai/_lib/taskWriterRun"].prepareTaskWriterRun = async () => ({ selected: { model: {} }, messages: [], instructions: "private prompt" });
  stubs.ai.streamText = () => ({ textStream: (async function* () { throw error; })() });
  const { POST } = loadRoute("src/app/api/ai/task-writer/route.ts", stubs);
  const response = await POST({ json: async () => ({ projectId: 15 }) });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'event: error\ndata: {"type":"error","content":"Provider unavailable"}\n\nevent: done\ndata: {"status":"error"}\n\n');
  assert.equal(reports.length, 1);
  assertSafeReport(reports[0], error, "/api/ai/task-writer");
  assert.equal(reports[0].extra.stage, "stream");
});
