const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const mobileButton = read("src/components/Global/MobileCreateTaskButton.tsx");
const createTaskModal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
const writerContainer = read(
  "src/components/PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer.tsx",
);
const createBody = read(
  "src/components/Modals/CreateTaskGloballyModal/CreateTaskModalBody.tsx",
);
const properties = read(
  "src/components/Modals/CreateTaskGloballyModal/TaskInfoColumnGloballyCreate.tsx",
);
const assignees = read(
  "src/components/Modals/CreateTaskGloballyModal/AssigneesTaskGlobal/AssigneesContainerCreateTaskGlobally.tsx",
);
const startDate = read("src/components/Modals/StartDate/index.tsx");
const createRoute = read("src/pages/api/tasks/createGlobally.ts");

const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.DOMParser = dom.window.DOMParser;
const { extractTaskProperties } = jiti(
  path.join(root, "src/utils/aiWriterUtils.ts"),
);

test("mobile plus opens the create modal in AI task-writer mode", () => {
  assert.match(mobileButton, /defaultEditMode: "Description-ai"/);
  assert.match(mobileButton, /defaultFocus: "Description"/);
});

test("mobile create uses the shared writer and applies its response before save", () => {
  assert.match(createTaskModal, /projectAssignees=\{projectAssignees\}/);
  assert.match(createTaskModal, /mobileCreateTask=\{mobileCreateTask\}/);
  assert.match(
    createTaskModal,
    /applyCreateTaskResult=\{applyCreateTaskResult\}/,
  );
  assert.match(
    createTaskModal,
    /if \(!formValues\.title\.trim\(\) && result\.title/,
  );
  assert.match(
    createTaskModal,
    /if \(!formValues\.priority && result\.priority/,
  );
  assert.match(createTaskModal, /if \(!formValues\.dueDate && result\.dueDate/);
  assert.match(
    createTaskModal,
    /if \(!formValues\.startDate && result\.startDate/,
  );
  assert.match(createTaskModal, /responseProjectId !== currentProjectId/);
  assert.match(createTaskModal, /setTaskWriterFilled\(changed\)/);
  assert.match(
    writerContainer,
    /!isMobileCreateFlow && !isLoading && currentDisplayResponse/,
  );
  assert.match(
    writerContainer,
    /const aiOptionsEl[\s\S]*?!isMobileCreateFlow && !isLoading && currentDisplayResponse/,
  );
});

test("classic form carries content back into the shared writer", () => {
  assert.match(writerContainer, /Already in the form/);
  assert.match(writerContainer, /What should the writer add or change\?/);
  assert.match(createTaskModal, /onClassicForm: showClassicForm/);
  assert.match(createTaskModal, /formSummary: hasOpenedClassicForm/);
  assert.match(properties, /onClick=\{property\.onClick\}/);
});

test("mobile classic properties appear before the description and include start date", () => {
  assert.match(
    createBody,
    /<TaskInfoColumnContainer[\s\S]*?<DescriptionCreateTaskModal \/>/,
  );
  for (const label of [
    "Board",
    "Section",
    "Priority",
    "Labels",
    "Due",
    "Size",
    "Start",
  ]) {
    assert.match(properties, new RegExp(`label: "${label}"`));
  }
  assert.match(properties, /<AssigneesContainerCreateTaskGlobally[\s\S]*?compact/);
  assert.match(assignees, /compact[\s\S]*?Assignee:/);
  assert.match(properties, /Filled in by the AI task writer/);
  assert.match(properties, /mode="Create"/);
  assert.match(properties, /<StartDateModal/);
});

test("start-date selection is local to create mode and is persisted in task creation", () => {
  assert.match(startDate, /mode === "Update" && inViewObject\.taskId/);
  assert.match(createRoute, /startDate,/);
  assert.match(createRoute, /startDate,\n\s+\/\/ Explicit/);
  assert.match(createRoute, /id: normalizedSectionId,[\s\S]*?projectId,/);
  assert.match(createRoute, /Section does not belong to this project/);
});

test("malformed and foreign AI markers never escape the loaded board allowlists", () => {
  const result = extractTaskProperties(
    [
      '<h1 id="ai-generated-task-title">Generated title</h1>',
      '<span id="ai-generated-task-priority">2x</span>',
      '<span id="ai-generated-task-estimate">3</span>',
      '<span id="ai-generated-task-tags">foreign-label, label-good</span>',
      '<span id="ai-generated-task-status">99oops</span>',
      '<span id="ai-generated-task-assignees">foreign-user, 7</span>',
      '<span id="ai-generated-task-due-date">2026-02-30</span>',
      '<span id="ai-generated-task-start-date">2026-09-05</span>',
      "<p>Keep this description.</p>",
      "<p>Proposed properties: Priority High, Size S</p>",
    ].join(""),
    [{ id: "label-good", value: "Backend" }],
    [{ id: 12, section_title: "Triage" }],
    [
      { id: 7, displayName: "Valentin Yeo" },
      { id: "agent-good", displayName: "Build agent" },
    ],
  );

  assert.equal(result.priority, undefined);
  assert.equal(result.status, undefined);
  assert.deepEqual(
    result.tags?.map((tag) => tag.id),
    ["label-good"],
  );
  assert.deepEqual(
    result.assignees?.map((assignee) => assignee.id),
    [7],
  );
  assert.equal(result.dueDate, undefined);
  assert.equal(result.startDate?.getFullYear(), 2026);
  assert.equal(result.startDate?.getMonth(), 8);
  assert.equal(result.startDate?.getDate(), 5);
  assert.match(result.description, /Keep this description/);
  assert.doesNotMatch(result.description, /Proposed properties/);
});
