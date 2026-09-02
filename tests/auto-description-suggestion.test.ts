import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTaskWriterPrompt,
  canTakeOverDescription,
  canUndoDescriptionTakeover,
  dismissDescriptionSuggestion,
  hasDescriptionContent,
  isDescriptionSuggestionDismissed,
  mergeDescriptionTakeoverAttachments,
  resolveTaskWriterSubmitPrompt,
  shouldSuggestDescription,
  snapshotDescriptionAttachments,
} from "../src/lib/ai/autoDescriptionSuggestion";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const eligible = {
  enabled: true,
  isDesktop: true,
  title: "Draft onboarding checklist",
  savedDescription: "<p></p>",
  draftDescription: "",
  draftsHydrated: true,
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

test("description suggestions require a hydrated desktop title-only task", () => {
  assert.equal(shouldSuggestDescription(eligible), true);
  assert.equal(shouldSuggestDescription({ ...eligible, isDesktop: false }), false);
  assert.equal(shouldSuggestDescription({ ...eligible, draftsHydrated: false }), false);
  assert.equal(
    shouldSuggestDescription({ ...eligible, preferencesHydrated: false }),
    false,
  );
  assert.equal(shouldSuggestDescription({ ...eligible, title: " " }), false);
  assert.equal(
    shouldSuggestDescription({ ...eligible, savedDescription: "<p>Saved</p>" }),
    false,
  );
  assert.equal(
    shouldSuggestDescription({ ...eligible, draftDescription: "<p>Draft</p>" }),
    false,
  );
  assert.equal(shouldSuggestDescription({ ...eligible, enabled: false }), false);
  assert.equal(shouldSuggestDescription({ ...eligible, dismissed: true }), false);
});

test("empty markup stays eligible while text and media count as descriptions", () => {
  assert.equal(hasDescriptionContent("<html><body><p><br></p></body></html>"), false);
  assert.equal(hasDescriptionContent("<p>&nbsp;</p>"), false);
  assert.equal(hasDescriptionContent("<p>\u200B&#8203;&#x200C;</p>"), false);
  assert.equal(hasDescriptionContent("<p>Existing details</p>"), true);
  assert.equal(hasDescriptionContent('<p><img src="example.png"></p>'), true);
});

test("takeover requires an empty editor and Undo requires unchanged generated content", () => {
  const takeover = {
    before: "<p></p>",
    inserted: "<p>AI draft</p>",
  };
  const generatedFile = {
    id: "ai-0",
    name: "draft.png",
    size: "42",
    type: "image/png",
    source: "https://example.com/draft.png",
  };

  assert.equal(canTakeOverDescription(takeover.before), true);
  assert.equal(canTakeOverDescription("<p>User text</p>"), false);
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
  assert.notEqual(
    snapshotDescriptionAttachments([generatedFile, { name: "user.png" }]),
    snapshotDescriptionAttachments([generatedFile]),
  );
});

test("task dismissals are user-scoped, deduplicated, and bounded", () => {
  const storage = new MemoryStorage();
  assert.equal(dismissDescriptionSuggestion(storage, 6, 42), true);
  assert.equal(dismissDescriptionSuggestion(storage, 6, 42), true);
  assert.equal(isDescriptionSuggestionDismissed(storage, 6, 42), true);
  assert.equal(isDescriptionSuggestionDismissed(storage, 7, 42), false);

  for (let taskId = 1; taskId <= 110; taskId += 1) {
    dismissDescriptionSuggestion(storage, 6, taskId);
  }
  assert.equal(isDescriptionSuggestionDismissed(storage, 6, 1), false);
  assert.equal(isDescriptionSuggestionDismissed(storage, 6, 110), true);
});

test("corrupt storage self-heals while unavailable storage fails closed", () => {
  const storage = new MemoryStorage();
  const key = "hypertask:auto-description-dismissed:6";
  storage.setItem(key, "not json");
  assert.equal(isDescriptionSuggestionDismissed(storage, 6, 42), false);
  assert.equal(storage.getItem(key), null);

  storage.setItem(key, JSON.stringify({ taskId: 42 }));
  assert.equal(dismissDescriptionSuggestion(storage, 6, 42), true);
  assert.equal(isDescriptionSuggestionDismissed(storage, 6, 42), true);

  const unavailable = new MemoryStorage();
  unavailable.getItem = () => { throw new Error("blocked"); };
  assert.equal(isDescriptionSuggestionDismissed(unavailable, 6, 42), true);
  assert.equal(dismissDescriptionSuggestion(unavailable, 6, 42), false);
});
