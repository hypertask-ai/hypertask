import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildTaskWriterPrompt,
  canApplyCreateDescriptionSuggestion,
  canUndoDescriptionTakeover,
  hasDescriptionContent,
  hasMeaningfulDescriptionSuggestionTitle,
  mergeDescriptionTakeoverAttachments,
  resolveTaskWriterSubmitPrompt,
  shouldSuggestCreateDescription,
  snapshotDescriptionAttachments,
} from "../src/lib/ai/autoDescriptionSuggestion";

const eligible = {
  enabled: true,
  isDesktop: true,
  title: "Draft onboarding checklist",
  description: "<p></p>",
  preferencesHydrated: true,
  dismissed: false,
};

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

test("new-task description suggestions require a hydrated desktop form with a meaningful title", () => {
  assert.equal(shouldSuggestCreateDescription(eligible), true);
  assert.equal(
    shouldSuggestCreateDescription({ ...eligible, isDesktop: false }),
    false,
  );
  assert.equal(
    shouldSuggestCreateDescription({ ...eligible, preferencesHydrated: false }),
    false,
  );
  assert.equal(
    shouldSuggestCreateDescription({ ...eligible, title: "new task" }),
    false,
  );
  assert.equal(
    shouldSuggestCreateDescription({ ...eligible, title: "Fix login" }),
    false,
  );
  assert.equal(
    shouldSuggestCreateDescription({ ...eligible, title: "Fix --- login failure" }),
    true,
  );
  assert.equal(
    shouldSuggestCreateDescription({ ...eligible, description: "<p>Details</p>" }),
    false,
  );
  assert.equal(shouldSuggestCreateDescription({ ...eligible, enabled: false }), false);
  assert.equal(shouldSuggestCreateDescription({ ...eligible, dismissed: true }), false);
});

test("meaningful title detection normalizes punctuation, whitespace, case, and non-English words", () => {
  assert.equal(hasMeaningfulDescriptionSuggestionTitle("  FIX   LOGIN   FAILURE  "), true);
  assert.equal(hasMeaningfulDescriptionSuggestionTitle("Plan, launch, review"), true);
  assert.equal(hasMeaningfulDescriptionSuggestionTitle("修复 登录 问题"), true);
  assert.equal(hasMeaningfulDescriptionSuggestionTitle("... !!!"), false);
});

test("stale or unsafe create-form drafts cannot take over the description", () => {
  assert.equal(
    canApplyCreateDescriptionSuggestion(
      "Draft onboarding checklist",
      "Draft onboarding checklist",
      "<p></p>",
      true,
      false,
    ),
    true,
  );
  assert.equal(
    canApplyCreateDescriptionSuggestion(
      "Draft onboarding checklist",
      "Draft a different checklist",
      "<p></p>",
      true,
      false,
    ),
    false,
  );
  assert.equal(
    canApplyCreateDescriptionSuggestion(
      "Draft onboarding checklist",
      "Draft onboarding checklist",
      "<p>User details</p>",
      true,
      false,
    ),
    false,
  );
  assert.equal(
    canApplyCreateDescriptionSuggestion(
      "Draft onboarding checklist",
      "Draft onboarding checklist",
      "<p></p>",
      false,
      false,
    ),
    false,
  );
  assert.equal(
    canApplyCreateDescriptionSuggestion(
      "Draft onboarding checklist",
      "Draft onboarding checklist",
      "<p></p>",
      true,
      true,
    ),
    false,
  );
});

test("empty markup stays eligible while text and media count as descriptions", () => {
  assert.equal(hasDescriptionContent("<html><body><p><br></p></body></html>"), false);
  assert.equal(hasDescriptionContent("<p>&nbsp;</p>"), false);
  assert.equal(hasDescriptionContent("<p>\u200B&#8203;&#x200C;</p>"), false);
  assert.equal(hasDescriptionContent("<p>Existing details</p>"), true);
  assert.equal(hasDescriptionContent('<p><img src="example.png"></p>'), true);
});

test("Undo requires unchanged generated content and attachment snapshots remain stable", () => {
  const takeover = { before: "<p></p>", inserted: "<p>AI draft</p>" };
  const generatedFile = {
    id: "ai-0",
    name: "draft.png",
    size: "42",
    type: "image/png",
    source: "https://example.com/draft.png",
  };

  assert.equal(canUndoDescriptionTakeover(takeover.inserted, takeover), true);
  assert.equal(
    canUndoDescriptionTakeover("<p>AI draft with user edit</p>", takeover),
    false,
  );
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

test("automatic description UI exists only in the new-task form", () => {
  const root = resolve(import.meta.dirname, "..");
  const createForm = readFileSync(
    resolve(root, "src/components/RTE/TiptapCreateTaskModal.tsx"),
    "utf8",
  );
  const taskDetail = readFileSync(
    resolve(root, "src/components/RTE/TipTapTaskDetail.tsx"),
    "utf8",
  );

  const takeoverHandler = createForm.slice(
    createForm.indexOf("const handleAutoDescriptionTakeover"),
    createForm.indexOf("const undoAutoDescriptionTakeover"),
  );

  assert.match(createForm, /id="create-task-auto-description-writer"/);
  assert.match(createForm, /requestKind="auto-description"/);
  assert.match(
    createForm,
    /CreateTaskAndDescription\(\s*descriptionAtSave,\s*titleAtSave,\s*formValuesAtSave,\s*\)/,
  );
  assert.match(
    createForm,
    /if \(takeover && description !== takeover\.inserted\) \{[\s\S]*?setAutoDescriptionTakeover\(null\)/,
  );
  assert.doesNotMatch(
    takeoverHandler,
    /setNewCommentAttachments|callbackAttachments/,
    "taking over a text suggestion must leave selected attachments unchanged",
  );
  assert.doesNotMatch(taskDetail, /requestKind="auto-description"/);
  assert.match(taskDetail, /shouldTriggerAiTaskWriter/);
});
