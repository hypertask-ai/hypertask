const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("every global create save mode snapshots the current TipTap description", () => {
  const source = read("src/components/RTE/TiptapCreateTaskModal.tsx");

  assert.match(
    source,
    /let descriptionAtSave = editor\?\.getHTML\(\) \?\? formValues\.description;/,
  );
  assert.equal(
    source.match(/CreateTaskAndDescription\(descriptionAtSave, titleAtSave\)/g)?.length,
    3,
    "Save, Save & close, and Save & new must all use the editor snapshot",
  );
});

test("a missing title is generated from the save-time description before every save mode", () => {
  const source = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  const stateSource = read("src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts");
  const titleSource = read("src/components/Modals/CreateTaskGloballyModal/TaskTitleModal.tsx");

  assert.match(source, /if \(!titleAtSave\) \{[\s\S]*?await generateTitleFromDescription\(descriptionAtSave\);[\s\S]*?titleAtSave = generatedTitle;/);
  assert.match(stateSource, /taskDescription: description,[\s\S]*?extractTitleAndDescription\(generatedHtml\)\.title/);
  assert.match(
    stateSource,
    /CreateNewTask\(\s*processedPayload,\s*titleOverride,\s*traceScope,?\s*\)/,
    "the generated title must be passed directly into creation without waiting for React state",
  );
  assert.match(titleSource, /Generating title from description…/);
  assert.match(titleSource, /role="alert"/);
});

test("global task creation processes the save-time description override", () => {
  const source = read(
    "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts",
  );

  assert.match(
    source,
    /const descriptionAtSave = descriptionOverride \?\? formValues\.description;/,
  );
  assert.match(source, /processHtmlForTaskId\(descriptionAtSave\)/);
});

test("the create route persists the request description atomically", () => {
  const source = read("src/pages/api/tasks/createGlobally.ts");

  assert.match(
    source,
    /description_:\s*\{\s*create:\s*\{\s*content: description \?\? ""/,
  );
});

// A discard during title generation must not create a task from the dead
// draft: the epoch bumps on every composer reset and the save re-checks it
// after the await (claude-review MAJOR on #2756).
test("discard during title generation cancels the pending save", () => {
  const modal = fs.readFileSync(
    path.join(root, "src/components/RTE/TiptapCreateTaskModal.tsx"),
    "utf8",
  );
  assert.match(modal, /const epochAtSave = saveEpochRef\.current;/);
  assert.match(
    modal,
    /if \(generatedTitle === null \|\| saveEpochRef\.current !== epochAtSave\) \{\s*setUploadInProgress\(false\);\s*return;/,
  );
  const hook = fs.readFileSync(
    path.join(root, "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts"),
    "utf8",
  );
  assert.match(
    hook,
    /const resetFormValues = \(\) => \{\s*saveEpochRef\.current \+= 1;/,
    "every composer reset must invalidate in-flight saves",
  );
});


// Title generation is async and the description stays editable during it, so
// the save must re-read the editor afterwards instead of persisting the
// pre-generation snapshot (claude-review MAJOR on #2756).
test("edits made while a title generates are still saved", () => {
  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  assert.match(
    modal,
    /descriptionAtSave = editor\?\.getHTML\(\) \?\? descriptionAtSave;/,
  );
});

// A save invoked without a mode matches none of the branches, so it must not
// start generation or leave uploadInProgress stuck on (claude-review on #2756).
test("a save without a mode exits before any work starts", () => {
  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  assert.match(modal, /if \(!param\) return;/);
});

// Switching boards mid-generation invalidates the request: it was scoped to
// the previous board's AI configuration (claude-review MINOR on #2756).
test("switching boards cancels an in-flight title request", () => {
  const hook = read("src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts");
  assert.match(
    hook,
    /const handleProjectChange = \(project: IProject\) => \{[\s\S]{0,200}?saveEpochRef\.current \+= 1;/,
  );
});

test("accepted Task Writer titles are tracked for later edit learning", () => {
  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  const hook = read("src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts");

  assert.match(
    modal,
    /returnTitleAndDescription=\{\(title, description, props\) => \{[\s\S]*?if \(title\) \{\s*handleChange\("title", title\);\s*recordGeneratedTitle\(title\);/,
  );
  assert.match(
    hook,
    /generatedTitleTrackerRef\.current\.takeSignal\(savedTitle\)[\s\S]*?if \(titleEditSignal\) \{[\s\S]*?recordBoardMemorySignal\([\s\S]*?titleEditSignal/,
  );
});

test("a title generated for a discarded or switched-away draft is thrown away", () => {
  const stateSource = read(
    "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts",
  );
  const modalSource = read("src/components/RTE/TiptapCreateTaskModal.tsx");

  // The epoch must be captured before the request, not read after it, or the
  // comparison is always true.
  assert.match(
    stateSource,
    /const epochAtRequest = saveEpochRef\.current;[\s\S]*?const response = await fetch\(taskWriterRoute/,
  );
  // The guard has to sit before handleChange, otherwise the stale title is
  // already in the new draft by the time the caller notices.
  assert.match(
    stateSource,
    /if \(saveEpochRef\.current !== epochAtRequest\) return null;\s*handleChange\("title", title\);/,
  );
  // Both a discard/reset and a board switch bump the epoch.
  // Invalidating a request also owns clearing the spinner, or it stays stuck.
  assert.match(
    stateSource,
    /resetFormValues = \(\) => \{\s*saveEpochRef\.current \+= 1;[\s\S]{0,200}?setIsGeneratingTitle\(false\);/,
  );
  assert.match(
    stateSource,
    /if \(saveEpochRef\.current === epochAtRequest\) setIsGeneratingTitle\(false\);/,
    "a stale request must not clear the spinner a newer request owns",
  );
  assert.match(
    stateSource,
    /handleProjectChange = \(project: IProject\) => \{[\s\S]*?saveEpochRef\.current \+= 1;\s*setIsGeneratingTitle\(false\);/,
  );
  assert.match(
    modalSource,
    /if \(saveEpochRef\.current !== epochAtSave\) return;/,
    "a stale failure must not switch the current draft into title editing",
  );
  // The caller treats null as "cancelled" and never creates a task from it.
  assert.match(
    modalSource,
    /if \(generatedTitle === null \|\| saveEpochRef\.current !== epochAtSave\) \{\s*setUploadInProgress\(false\);\s*return;/,
  );
});
