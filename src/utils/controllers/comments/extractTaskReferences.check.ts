import assert from "node:assert";
// @ts-expect-error Node strip-types checks require .ts imports without allowImportingTsExtensions.
import { extractTaskReferencesFromCommentText } from "./extractTaskReferences.ts";

assert.deepStrictEqual(
  extractTaskReferencesFromCommentText(
    '<p>See <a href="/detail/project-4/70">this task</a>.</p>'
  ),
  [{ projectId: "4", uniqueIndex: "70" }],
  "human-authored link still extracted"
);

assert.deepStrictEqual(
  extractTaskReferencesFromCommentText(
    '<p>See <a href="/detail/project-4/70" data-ai-linkified="1">HTPR-70</a> for details.</p>'
  ),
  [],
  "AI-linkified anchor produces no relation-extraction match"
);

assert.deepStrictEqual(
  extractTaskReferencesFromCommentText(
    '<p>Mentioned <a href="/detail/project-4/70" data-ai-linkified="1">HTPR-70</a>, ' +
      'related to <a href="/detail/project-4/71">HTPR-71</a>.</p>'
  ),
  [{ projectId: "4", uniqueIndex: "71" }],
  "AI-linkified anchor skipped, human-authored link in the same text still extracted"
);

console.log("extractTaskReferences: all checks passed");
