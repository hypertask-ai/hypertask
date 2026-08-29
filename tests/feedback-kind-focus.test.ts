import assert from "node:assert/strict";
import test from "node:test";
import { selectFeedbackKind } from "../src/components/Modals/Feedback/feedbackKindSelection";

test("choosing a feedback kind restores editor focus after selection", () => {
  for (const kind of ["Idea", "Question", "Praise"] as const) {
    const calls: string[] = [];
    let selectedKind = "Bug";
    let editorFocused = false;

    selectFeedbackKind(
      kind,
      (selected) => {
        calls.push("select");
        selectedKind = selected;
      },
      () => {
        calls.push("focus");
        editorFocused = true;
      },
    );

    assert.equal(selectedKind, kind);
    assert.equal(editorFocused, true);
    assert.deepEqual(calls, ["select", "focus"]);
  }
});
