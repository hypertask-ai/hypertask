const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true });
const {
  buildTaskWriterAutoDraftPrompt,
  resolveCreateTaskWriterOpening,
  resolveTaskDetailWriterOpening,
  resolveTaskWriterDescription,
} = jiti(path.join(root, "src/lib/ai/taskWriterAutoDraft.ts"));

test("empty tickets keep the Task Writer prompt", () => {
  assert.equal(
    buildTaskWriterAutoDraftPrompt({
      title: "  ",
      description: "<p><br></p>",
      tags: [{ value: "AI Task Writer" }],
      priority: { Priority_Value: "High" },
      estimate: { estimate_value: "S" },
    }),
    null,
  );
});

test("a title immediately drafts with the ticket properties as context", () => {
  const prompt = buildTaskWriterAutoDraftPrompt({
    title: "Fix the export timeout",
    description: "<p></p>",
    tags: [{ value: "Backend" }, { value: "Bug" }],
    priority: { Priority_Value: "Urgent" },
    estimate: { estimate_value: "M" },
  });

  assert.match(prompt, /Draft this task now from the ticket's existing content/);
  assert.match(prompt, /Title: Fix the export timeout/);
  assert.match(prompt, /Tags: Backend, Bug/);
  assert.match(prompt, /Priority: Urgent/);
  assert.match(prompt, /Size: M/);
});

test("text or media in the description starts a draft without a title", () => {
  assert.ok(
    buildTaskWriterAutoDraftPrompt({
      title: "",
      description: "<p>Export fails after 30 seconds.</p>",
    }),
  );
  assert.ok(
    buildTaskWriterAutoDraftPrompt({
      title: "",
      description: '<p><img src="data:image/png;base64,abc"></p>',
    }),
  );
});

test("saved content wins when an initializing editor only has empty markup", () => {
  assert.equal(
    resolveTaskWriterDescription(
      "<p><br></p>",
      "<p>Saved repro steps.</p>",
    ),
    "<p>Saved repro steps.</p>",
  );
});

test("create-task openings preserve explicit prompts without auto-triggering", () => {
  assert.deepEqual(
    resolveCreateTaskWriterOpening(
      "Use the selected template",
      "Draft from the ticket",
    ),
    {
      autoTrigger: false,
      initialPrompt: "Use the selected template",
    },
  );

  assert.deepEqual(
    resolveCreateTaskWriterOpening(undefined, "Draft from the ticket"),
    {
      autoTrigger: true,
      initialPrompt: "Draft from the ticket",
    },
  );

  assert.deepEqual(
    resolveCreateTaskWriterOpening("", "Draft from the ticket"),
    {
      autoTrigger: true,
      initialPrompt: "Draft from the ticket",
    },
  );
});

test("existing-task openings keep event prompts ahead of content prompts", () => {
  assert.deepEqual(
    resolveTaskDetailWriterOpening(
      true,
      "Summarize the linked task",
      "Draft from the ticket",
    ),
    {
      autoTrigger: true,
      initialPrompt: "Summarize the linked task",
    },
  );

  assert.deepEqual(
    resolveTaskDetailWriterOpening(false, "", "Draft from the ticket"),
    {
      autoTrigger: true,
      initialPrompt: "Draft from the ticket",
    },
  );

  assert.deepEqual(
    resolveTaskDetailWriterOpening(
      false,
      "Use the selected template",
      "Draft from the ticket",
    ),
    {
      autoTrigger: false,
      initialPrompt: "Use the selected template",
    },
  );
});
