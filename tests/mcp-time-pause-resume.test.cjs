// HTPR-5163: bearer-token callers could start and stop timers, but the pause
// and resume routes only existed on the cookie-authenticated web surface.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const functionSource = (source, name, nextName) => {
  const start = source.indexOf(`export async function ${name}`);
  const end = nextName
    ? source.indexOf(`export async function ${nextName}`, start)
    : source.length;
  return source.slice(start, end);
};

const pauseRoute = read("src/app/api/mcp/time/pause/route.ts");
const resumeRoute = read("src/app/api/mcp/time/resume/route.ts");
const stopRoute = read("src/app/api/mcp/time/stop/route.ts");
const timeTracking = read("src/lib/timeTracking.ts");
const timeEntryWriter = read("src/lib/timeEntryWriter.ts");
const pauseLib = functionSource(timeTracking, "pauseTimer", "resumeTimer");
const resumeLib = functionSource(timeTracking, "resumeTimer", "logMinutes");
const resumeWriter = functionSource(
  timeEntryWriter,
  "resumeTimerOnActiveBoard"
);
const pauseWriter = functionSource(
  timeEntryWriter,
  "pauseTimerOnActiveBoard"
);
const stopLib = functionSource(timeTracking, "stopTimer", "pauseTimer");

test("pause on a running timer sets pausedAt and reports success", () => {
  assert.match(pauseLib, /pauseTimerOnActiveBoard\(/);
  assert.match(pauseWriter, /where: \{ userId, taskId, endedAt: null, pausedAt: null \}/);
  assert.match(pauseWriter, /data: \{ pausedAt: now \}/);
  assert.match(pauseWriter, /return \{ \.\.\.runningEntry, pausedAt: now \}/);
  assert.match(
    pauseRoute,
    /pauseTimer\(\s*resolved\.ctx\.user\.id,\s*resolved\.task\.id,\s*resolved\.ctx\.agentId\s*\)/
  );
  assert.match(pauseRoute, /NextResponse\.json\(\{ success: true, entry \}\)/);
});

test("pause with no running timer returns a 404 failure", () => {
  assert.match(
    pauseRoute,
    /if \(!entry\) \{[\s\S]*?\{ success: false, error: "There is no running timer on that task\." \}[\s\S]*?\{ status: 404 \}/
  );
  assert.ok(
    pauseRoute.indexOf("if (!entry)") <
      pauseRoute.indexOf("NextResponse.json({ success: true, entry })"),
    "a null entry must fail before the success response"
  );
});

test("resume on a paused timer clears pausedAt", () => {
  assert.match(
    resumeLib,
    /resumeTimerOnActiveBoard\(\s*timeWriteClient,\s*userId,\s*taskId,\s*getProjectWhere\(userId, agentId\)\s*\)/
  );
  assert.match(resumeWriter, /pausedAt: \{ not: null \}/);
  assert.match(resumeWriter, /data: \{ startedAt, pausedAt: null \}/);
  assert.match(
    resumeWriter,
    /return \{ \.\.\.pausedEntry, startedAt, pausedAt: null \}/
  );
  assert.match(
    resumeRoute,
    /resumeTimer\(\s*resolved\.ctx\.user\.id,\s*resolved\.task\.id,\s*resolved\.ctx\.agentId\s*\)/
  );
  assert.match(resumeRoute, /NextResponse\.json\(\{ success: true, entry \}\)/);
});

test("resume with no paused timer returns a 404 failure", () => {
  assert.match(
    resumeRoute,
    /if \(!entry\) \{[\s\S]*?\{ success: false, error: "There is no paused timer on that task\." \}[\s\S]*?\{ status: 404 \}/
  );
  assert.ok(
    resumeRoute.indexOf("if (!entry)") <
      resumeRoute.indexOf("NextResponse.json({ success: true, entry })"),
    "a null entry must fail before the success response"
  );
});

test("both routes use the shared MCP task resolver", () => {
  for (const [name, source, operation] of [
    ["pause", pauseRoute, "pauseTimer("],
    ["resume", resumeRoute, "resumeTimer("],
  ]) {
    const resolverAt = source.indexOf("resolveMcpTimeTask(request)");
    const operationAt = source.indexOf(operation);
    assert.ok(resolverAt !== -1, `${name} must use resolveMcpTimeTask`);
    assert.ok(
      resolverAt < operationAt,
      `${name} must resolve auth and the task before changing the timer`
    );
  }
});

test("stopping a paused timer still ends it at pausedAt", () => {
  const writer = read("src/lib/timeEntryWriter.ts");
  const stopWriter = functionSource(
    writer,
    "stopTimerOnAccessibleBoard",
    "pauseTimerOnActiveBoard"
  );
  assert.match(stopLib, /stopTimerOnAccessibleBoard\(/);
  assert.match(stopWriter, /const endedAt = stoppedAt\(runningEntry\.pausedAt, now\)/);
  assert.match(stopWriter, /data: \{ endedAt \}/);
  assert.match(stopWriter, /return \{ \.\.\.runningEntry, endedAt \}/);
  assert.match(
    stopRoute,
    /resolveMcpTimeTask\(request, \{ allowArchived: true \}\)/
  );
});

test("pause and resume are registered for MCP and AI chat", () => {
  const tools = read("src/lib/mcp-server/tools/index.ts");
  const metadata = read("src/lib/mcp-server/config/tool-metadata.ts");
  const service = read("src/lib/mcp-server/lib/services/time.service.ts");
  const validation = read("src/lib/mcp-server/validations/time.validation.ts");
  const aiChat = read("src/app/api/ai/chat/stream/route.ts");

  assert.match(tools, /pauseTimerTool/);
  assert.match(tools, /resumeTimerTool/);
  assert.match(metadata, /buildToolName\('pause_timer'\)/);
  assert.match(metadata, /buildToolName\('resume_timer'\)/);
  assert.match(service, /'\/mcp\/time\/pause'/);
  assert.match(service, /'\/mcp\/time\/resume'/);
  assert.match(validation, /export const TimeTaskInputSchema/);
  assert.match(aiChat, /hypertask_pause_timer: tool\(\{/);
  assert.match(aiChat, /hypertask_resume_timer: tool\(\{/);
});
