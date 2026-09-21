// Runnable check for HTPR-3953: AI-linkified anchors must not create task relations.
// Run: node --experimental-strip-types src/utils/controllers/comments/extractTaskReferences.check.ts
import assert from "node:assert";
// @ts-ignore -- explicit .ts extension is required by `node --experimental-strip-types`
import { extractTaskReferencesFromCommentText } from "./extractTaskReferences.ts";

// Human-authored link: still creates a relation (unchanged behavior).
assert.deepStrictEqual(
  extractTaskReferencesFromCommentText(
    '<p>See <a href="/detail/project-4/70">this task</a>.</p>'
  ),
  [{ projectId: "4", uniqueIndex: "70" }],
  "human-authored link still extracted"
);

// AI-linkified anchor (data-ai-linkified="1"): incidental mention, no relation.
assert.deepStrictEqual(
  extractTaskReferencesFromCommentText(
    '<p>See <a href="/detail/project-4/70" data-ai-linkified="1">HTPR-70</a> for details.</p>'
  ),
  [],
  "AI-linkified anchor produces no relation-extraction match"
);

// Mixed: AI-linkified anchor is dropped, human-authored link alongside it still counts.
assert.deepStrictEqual(
  extractTaskReferencesFromCommentText(
    '<p>Mentioned <a href="/detail/project-4/70" data-ai-linkified="1">HTPR-70</a>, ' +
      'related to <a href="/detail/project-4/71">HTPR-71</a>.</p>'
  ),
  [{ projectId: "4", uniqueIndex: "71" }],
  "AI-linkified anchor skipped, human-authored link in the same text still extracted"
);

console.log("extractTaskReferences: all checks passed");
