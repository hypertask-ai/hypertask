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
    /let descriptionAtSave =\s*formValuesOverride\?\.description \?\? editor\?\.getHTML\(\) \?\? formValues\.description;/,
  );
  assert.equal(
    source.match(/CreateTaskAndDescription\(\s*descriptionAtSave,\s*titleAtSave/g)?.length,
    3,
    "Save, Save & close, and Save & new must all use the save snapshot",
  );
});

test("a missing or stale generated title is refreshed from the save-time description", () => {
  const source = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  const stateSource = read("src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts");
  const titleSource = read("src/components/Modals/CreateTaskGloballyModal/TaskTitleModal.tsx");

  assert.match(source, /if \(shouldGenerateTitleForSave\(titleAtSave, descriptionAtSave\)\) \{[\s\S]*?while \(shouldGenerateTitleForSave\(titleAtSave, descriptionAtSave\)\) \{[\s\S]*?await generateTitleFromDescription\(descriptionAtSave\);[\s\S]*?titleAtSave = generatedTitle;/);
  assert.match(stateSource, /taskDescription: description,[\s\S]*?extractTitleAndDescription\(generatedHtml\)\.title/);
  assert.match(
    stateSource,
    /CreateNewTask\(\s*processedPayload,\s*titleOverride,\s*traceScope,\s*formValuesAtSave,?\s*\)/,
    "the generated title must be passed directly into creation without waiting for React state",
  );
  assert.match(titleSource, /Generating…/);
  assert.doesNotMatch(titleSource, /Generating title from description…/);
  assert.match(titleSource, /role="alert"/);
});

test("global task creation processes the save-time description override", () => {
  const source = read(
    "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts",
  );

  assert.match(
    source,
    /const descriptionAtSave = descriptionOverride \?\? formValuesAtSave\.description;/,
  );
  assert.match(source, /processHtmlForTaskId\(descriptionAtSave\)/);
});

test("follower links use the created task board snapshot", () => {
  const source = read(
    "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts",
  );

  assert.match(
    source,
    /detail\/project-\$\{task\.projectId\}\/\$\{task\.uniqueIndex\}/,
  );
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
    /if \(saveEpochRef\.current !== epochAtSave\) \{\s*setUploadInProgress\(false\);\s*return;/,
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
  assert.match(
    hook,
    /const closeHandler = useCallback\([\s\S]*?if \(!hasUnsavedChanges\(\) \|\| save\) \{\s*saveEpochRef\.current \+= 1;\s*autoTitleCoordinator\.cancelPending\(\);/,
    "closing the mounted composer must stop an aborted generation from retrying save",
  );
});


// Title generation is async and the description stays editable during it, so
// the save must re-read the editor afterwards instead of persisting the
// pre-generation snapshot (claude-review MAJOR on #2756).
test("edits made while a title generates are still saved", () => {
  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  assert.match(
    modal,
    /descriptionAtSave =\s*formValuesOverride\?\.description \?\? editor\?\.getHTML\(\) \?\? descriptionAtSave;/,
  );
});

// A save invoked without a mode matches none of the branches, so it must not
// start generation or leave uploadInProgress stuck on (claude-review on #2756).
test("a save without a mode exits before any work starts", () => {
  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  assert.match(modal, /if \(!param\) return;/);
});

test("save-time title generation admits only one concurrent attempt", () => {
  const modal = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  assert.match(
    modal,
    /if \(titleGenerationForSaveRef\.current\) return;\s*titleGenerationForSaveRef\.current = true;[\s\S]*?finally \{\s*titleGenerationForSaveRef\.current = false;/,
  );
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
    /returnTitleAndDescription=\{\(title, description, props\) => \{[\s\S]*?if \(title\) applyTaskWriterTitle\(title\);/,
  );
  assert.match(
    hook,
    /const applyTaskWriterTitle = useCallback\([\s\S]*?taskWriterTitleApplied\(\);[\s\S]*?applyGeneratedTitle\(title\);/,
  );
  assert.match(
    hook,
    /generatedTitleTrackerRef\.current\.takeSignal\(savedTitle\)[\s\S]*?if \(titleEditSignal\) \{[\s\S]*?recordBoardMemorySignal\([\s\S]*?titleEditSignal/,
  );
});

test("discard, board switch, and newer writing invalidate generated titles", () => {
  const stateSource = read(
    "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts",
  );
  const modalSource = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  const coordinatorSource = read("src/lib/ai/autoTitleGeneration.ts");

  assert.match(
    stateSource,
    /resetFormValues = \(\) => \{\s*saveEpochRef\.current \+= 1;[\s\S]*?autoTitleCoordinator\.reset\(/,
  );
  assert.match(
    stateSource,
    /const handleProjectChange = \(project: IProject\) => \{[\s\S]{0,200}?saveEpochRef\.current \+= 1;/,
  );
  assert.match(
    stateSource,
    /const clearGeneratedTitle = autoTitleCoordinator\.boardChanged\(\);[\s\S]*?title: clearGeneratedTitle \? "" : prev\.title/,
  );
  assert.match(stateSource, /signal,\s*body: JSON\.stringify/);
  assert.match(
    coordinatorSource,
    /request\?\.abort\(\);[\s\S]*?generationRevision !== revision/,
  );
  assert.match(
    modalSource,
    /const onChangeHandler = \(\) => \{[\s\S]*?scheduleTitleGeneration\(description\);/,
    "description edits must invalidate pending generated titles",
  );
  assert.match(
    modalSource,
    /if \(saveEpochRef\.current !== epochAtSave\) \{\s*setUploadInProgress\(false\);\s*return;/,
  );
});
