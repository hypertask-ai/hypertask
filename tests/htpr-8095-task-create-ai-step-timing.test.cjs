const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

global.window = {
  location: { hostname: "app.hypertask.ai" },
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: () => 0,
};

const {
  beginTaskCreatePerformanceTrace,
  completeTaskCreatePerformanceTrace,
  installProductPerformanceSink,
  recordTaskCreateResponse,
} = jiti(path.join(root, "src/lib/analytics/productPerformance.ts"));

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const emitted = [];
installProductPerformanceSink((event) => emitted.push(event));

const beginAndCompleteSave = (aiSteps) => {
  emitted.length = 0;
  const scope = beginTaskCreatePerformanceTrace({
    accountId: 6,
    projectId: 15,
    ...aiSteps,
  });
  assert.ok(scope, "a task create trace begins");
  assert.equal(
    recordTaskCreateResponse({
      accountId: 6,
      projectId: 15,
      networkDurationMs: 782,
      responseStatus: 200,
      serverTimings: { validate: 86.5, taskCreate: 525.7, enrich: 1.3, total: 613.5 },
      result: "success",
      scope,
    }),
    true,
  );
  assert.equal(completeTaskCreatePerformanceTrace("task_detail", scope), true);
  assert.equal(emitted.length, 1);
  return emitted[0].properties;
};

test("a Ctrl+J New Task save reports the save, the screen update and both AI steps", () => {
  const properties = beginAndCompleteSave({ taskWriterMs: 2251.2, titleMs: 1078.8 });

  assert.equal(properties.duration_ms, 782);
  assert.ok(
    typeof properties.submit_to_visible_ms === "number",
    "the screen update is timed",
  );
  assert.equal(properties.ai_task_writer_ms, 2251);
  assert.equal(properties.ai_title_ms, 1079);
  assert.equal(properties.task_create_measurement_version, 3);
  console.log("HTPR-8095 all four step times present");
});

test("an AI step that did not run in that save is null, never a guess", () => {
  const properties = beginAndCompleteSave({ taskWriterMs: Number.NaN });

  assert.equal(properties.ai_task_writer_ms, null);
  assert.equal(properties.ai_title_ms, null);
  assert.equal(properties.duration_ms, 782);
});

test("the compose save times the task writer step around its AI call", () => {
  const compose = read("src/lib/ai/composeTask.ts");

  assert.match(
    compose,
    /const writerStartedAt = typeof performance === "undefined" \? 0 : performance\.now\(\);/,
  );
  assert.match(compose, /writerMs = performance\.now\(\) - writerStartedAt;/);
  assert.match(
    compose,
    /beginTaskCreatePerformanceTrace\(\{\s*accountId: userId,\s*projectId: project\.id,\s*taskWriterMs: writerMs,\s*\}\)/,
  );
  assert.match(compose, /createNewTaskGloballyAPIHandler\(\{[\s\S]*?\}, traceScope\)/);
  const writer = read("src/components/Modals/commands/HTC/ComposeTaskWriter.tsx");
  assert.match(writer, /completeTaskCreatePerformanceTraceAfterPaint\("task_detail", traceScope\)/);
  assert.match(writer, /completeTaskCreatePerformanceTrace\("error", traceScope\)/);
});

test("the New Task modal save times the title step around its AI call", () => {
  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");

  assert.match(
    modal,
    /const titleGenerationStartedAt = performance\.now\(\);/,
  );
  assert.match(modal, /titleGenerationMs = performance\.now\(\) - titleGenerationStartedAt;/);
  assert.equal(
    (modal.match(/titleGenerationMs,\n\s*\);/g) ?? []).length,
    3,
    "every save branch passes the title step to the create trace",
  );
  const hook = read("src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts");
  assert.match(hook, /titleMs: titleGenerationMs \?\? null,/);
  console.log("HTPR-8095 both save paths record their AI step");
});
