const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  buildTemplateDuplicatePayload,
  findTaskTemplateTargetSection,
  openTaskTemplateDraft,
  taskTemplatePickerForProject,
  taskTemplateSectionWhere,
} = jiti(
  path.join(root, "src/lib/taskTemplatePrefill.ts"),
);

test("task templates can target a hidden open section", () => {
  assert.deepEqual(taskTemplateSectionWhere(15), {
    projectId: 15,
    deleted: false,
  });
  assert.deepEqual(
    findTaskTemplateTargetSection([
      {
        id: 100,
        section_title: "Hidden intake",
        isDone: false,
        visibility: false,
      },
      { id: 101, section_title: "Done", isDone: true, visibility: true },
    ]),
    { id: 100, section_title: "Hidden intake", isDone: false, visibility: false },
  );
});

test("task templates build the duplicate payload consumed by the create modal", () => {
  const duplicate = buildTemplateDuplicatePayload(
    {
      id: 12,
      name: "Bug",
      title: "Bug: checkout fails",
      descriptionHtml: "<h2>Steps</h2><p>Open checkout.</p>",
      priorityIndex: 2,
      estimateIndex: 3,
      labelIds: ["live-label", "deleted-label"],
    },
    {
      labels: [
        { id: "live-label", value: "Bug", projectId: 15 },
        { id: "unrelated-label", value: "Research", projectId: 15 },
      ],
      targetSection: { id: 100, section_title: "Triage" },
    },
  );

  assert.equal(duplicate.title, "Bug: checkout fails");
  assert.equal(duplicate.description, "<h2>Steps</h2><p>Open checkout.</p>");
  assert.equal(duplicate.priority.priority_index, 2);
  assert.equal(duplicate.estimate.estimate_index, 3);
  assert.deepEqual(duplicate.taskLabels, [
    {
      labelId: "live-label",
      label: { id: "live-label", value: "Bug", projectId: 15 },
    },
  ]);
  assert.equal(duplicate.sectionId, 100);
  assert.equal(duplicate.section, "Triage");
});

test("task template prefill refuses to open without a non-done target section", () => {
  const duplicate = buildTemplateDuplicatePayload(
    {
      id: 12,
      name: "Bug",
      title: "Bug",
      descriptionHtml: "",
      priorityIndex: null,
      estimateIndex: null,
      labelIds: [],
    },
    { labels: [], targetSection: null },
  );

  assert.equal(duplicate, null);
});

test("task template selection opens an unsaved create-task draft", () => {
  const template = {
    id: 12,
    name: "Bug",
    title: "Bug title",
    descriptionHtml: "<h2>Steps</h2>",
    priorityIndex: null,
    estimateIndex: null,
    labelIds: [],
  };
  const context = {
    labels: [],
    targetSection: { id: 100, section_title: "Triage" },
  };
  let openedDraft = null;

  const opened = openTaskTemplateDraft(
    template.id,
    [template],
    context,
    (duplicate) => {
      openedDraft = duplicate;
    },
  );

  assert.equal(opened, true);
  assert.equal(openedDraft.title, "Bug title");
  assert.equal(openedDraft.sectionId, 100);
  assert.equal(
    openTaskTemplateDraft(99, [template], context, () => {
      throw new Error("missing templates must not open a draft");
    }),
    false,
  );
});

test("task template picker hides stale data after switching boards", () => {
  assert.deepEqual(
    taskTemplatePickerForProject(
      {
        projectId: 15,
        templates: [{ id: 12 }],
        context: {
          labels: [{ id: "bug", value: "Bug", projectId: 15 }],
          targetSection: { id: 100, section_title: "Triage" },
        },
      },
      339,
    ),
    {
      projectId: null,
      templates: [],
      context: { labels: [], targetSection: null },
    },
  );
});

test("the command palette no longer applies templates through the write endpoint", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/commands.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /axios\.post\("\/api\/task-templates\/apply"/);
  assert.match(source, /openTaskTemplateDraft/);
  assert.match(source, /taskTemplatePickerForProject/);
});
