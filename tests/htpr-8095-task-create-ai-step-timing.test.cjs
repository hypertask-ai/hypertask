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
    /const writerStartedAt = measureAiSteps && typeof performance !== "undefined" \? performance\.now\(\) : 0;/,
  );
  assert.match(compose, /if \(measureAiSteps && typeof performance !== "undefined"\) \{\s*writerMs = performance\.now\(\) - writerStartedAt;\s*\}/);
  assert.doesNotMatch(
    compose,
    /@\/lib\/analytics\/productPerformance/,
    "the compose module stays free of the analytics import so its existing test harnesses keep their stubs",
  );
  assert.match(compose, /const traceScope = trace \? trace\.begin\(writerMs\) : null;/);
  assert.match(compose, /createNewTaskGloballyAPIHandler\(\{[\s\S]*?\}, traceScope\)/);
  const writer = read("src/components/Modals/commands/HTC/ComposeTaskWriter.tsx");
  assert.match(writer, /completeTaskCreatePerformanceTraceAfterPaint\("task_detail", traceScope\)/);
  assert.match(writer, /completeTaskCreatePerformanceTrace\("error", traceScope\)/);
});

test("the New Task modal save times the title step around its AI call", () => {
  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");

  assert.match(modal, /const titleGenerationStartedAt = startAiStepTimer\(\);/);
  assert.match(modal, /titleGenerationMs = readAiStepMs\(titleGenerationStartedAt\);/);
  assert.equal(
    (modal.match(/titleGenerationMs,\n\s*\);/g) ?? []).length,
    3,
    "every save branch passes the title step to the create trace",
  );
  const hook = read("src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts");
  assert.match(hook, /titleMs: measuredTitleMs,/);
  console.log("HTPR-8095 both save paths record their AI step");
});

test("both AI step timings sit behind the HTPR-8095 flag", () => {
  const definition = read(
    "src/lib/flags/definitions/htpr-8095-task-create-ai-step-timing.ts",
  );
  assert.match(definition, /key: HTPR_8095_TASK_CREATE_AI_STEP_TIMING_FLAG/);
  assert.match(definition, /defaultMode: "EVERYONE"/);

  const writer = read("src/components/Modals/commands/HTC/ComposeTaskWriter.tsx");
  assert.match(writer, /const aiStepTimingEnabled = useFlag\(HTPR_8095_TASK_CREATE_AI_STEP_TIMING_FLAG\);/);
  assert.match(writer, /if \(aiStepTimingEnabled\) traceScope = composed\.traceScope;/);

  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  assert.match(modal, /const aiStepTimingEnabled = useFlag\(HTPR_8095_TASK_CREATE_AI_STEP_TIMING_FLAG\);/);
  assert.match(modal, /if \(aiStepTimingEnabled\) titleGenerationMs = readAiStepMs\(titleGenerationStartedAt\);/);

  const hook = read("src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts");
  assert.match(hook, /const aiStepTimingEnabled = useFlag\(HTPR_8095_TASK_CREATE_AI_STEP_TIMING_FLAG\);/);
  assert.match(hook, /if \(aiStepTimingEnabled\) measuredTitleMs = titleGenerationMs \?\? null;/);
  console.log("HTPR-8095 both AI step timings are flag-gated");
});
