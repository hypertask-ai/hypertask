import assert from "node:assert/strict";
import { readRefactoredSource as readFileSync } from "../src/app/detail/[...slug]/taskDetailTestSources.cjs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildTaskWriterPrompt,
  hasDescriptionContent,
  mergeDescriptionTakeoverAttachments,
  resolveTaskWriterSubmitPrompt,
  snapshotDescriptionAttachments,
} from "../src/lib/ai/autoDescriptionSuggestion";

test("task-writer prompts preserve user text and add title context once", () => {
  assert.equal(buildTaskWriterPrompt("Draft details"), "Draft details");
  assert.equal(
    buildTaskWriterPrompt("Draft details", "Prepare launch"),
    "This task has title: Prepare launch. Keep this in major consideration when creating title and description, improve it rather than just copy pasting\nDraft details",
  );
  assert.equal(
    resolveTaskWriterSubmitPrompt(true, "overlay", "Initial", "Follow-up"),
    "Initial",
  );
  assert.equal(
    resolveTaskWriterSubmitPrompt(
      true,
      "description-suggestion",
      "Initial",
      "Follow-up",
    ),
    "Follow-up",
  );
});

test("empty markup stays eligible while text and media count as descriptions", () => {
  assert.equal(hasDescriptionContent("<html><body><p><br></p></body></html>"), false);
  assert.equal(hasDescriptionContent("<p>&nbsp;</p>"), false);
  assert.equal(hasDescriptionContent("<p>\u200B&#8203;&#x200C;</p>"), false);
  assert.equal(hasDescriptionContent("<p>Existing details</p>"), true);
  assert.equal(hasDescriptionContent('<p><img src="example.png"></p>'), true);
});

test("description takeover attachment snapshots remain stable", () => {
  const generatedFile = {
    id: "ai-0",
    name: "draft.png",
    size: "42",
    type: "image/png",
    source: "https://example.com/draft.png",
  };

  assert.deepEqual(
    mergeDescriptionTakeoverAttachments(
      [{ id: "existing" }],
      [{ id: 0, file: generatedFile }],
    ),
    [{ id: "existing" }, { id: 0, file: generatedFile }],
  );
  assert.equal(
    snapshotDescriptionAttachments([{ id: 0, file: generatedFile }]),
    snapshotDescriptionAttachments([generatedFile]),
  );
});

test("new-task form keeps explicit Task Writer and save behavior without automatic drafts", () => {
  const root = resolve(import.meta.dirname, "..");
  const createForm = readFileSync(
    resolve(root, "src/components/RTE/TiptapCreateTaskModal.tsx"),
    "utf8",
  );
  const taskDetail = readFileSync(
    resolve(root, "src/components/RTE/TipTapTaskDetail.tsx"),
    "utf8",
  );

  assert.doesNotMatch(createForm, /autoDescription|auto-description|description-suggestion/);
  assert.match(createForm, /shouldShowAiTaskWriter &&/);
  assert.match(createForm, /<AITaskWriterContainer/);
  assert.match(createForm, /toggleAiTaskWriter=\{toggleAiTaskWriter\}/);
  assert.match(createForm, /initialPrompt=\{taskWriterOpening\.initialPrompt\}/);
  assert.match(
    createForm,
    /CreateTaskAndDescription\(\s*descriptionAtSave,\s*titleAtSave,\s*formValuesAtSave,?\s*\)/,
  );
  assert.match(taskDetail, /shouldTriggerAiTaskWriter/);
});
