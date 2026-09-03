const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// HTPR-6047 lever two: non-essential task-detail requests (AI chat
// suggestions, the share-link prefetch, the move-task sections prefetch)
// used to fire in the same burst as the requests the ready markers actually
// depend on. This pins the deferral so a future edit can't silently drop the
// gate: each hook must still take an `enabled` input, and the task-detail
// call sites must still pass the readiness flag through.

test("HTPR-6047: task-detail readiness effect flips the non-essential gate", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/app/detail/[...slug]/TaskDetailComp.tsx"),
    "utf8",
  );
  assert.ok(
    /setNonEssentialReady\(false\)/.test(src),
    "the gate must reset to false when a new task-detail open starts",
  );
  assert.ok(
    /setNonEssentialReady\(true\)/.test(src),
    "the gate must flip true once the readiness markers are found (or on timeout)",
  );
  assert.ok(
    /useGetTaskShareLinks\(\s*_parsedTask\.id,\s*_parsedTask\.projectId,\s*currentUser\?\.id!,\s*undefined,\s*nonEssentialReady,?\s*\)/.test(
      src,
    ),
    "the eager share-link prefetch must be gated on nonEssentialReady",
  );
  assert.ok(
    /useGetSectionsMoveTask\(\s*\[taskDetailConfig\.queryKeys\.moveTaskModal, currentProject\?\.id\],\s*currentProject\?\.id!,\s*undefined,\s*nonEssentialReady,?\s*\)/.test(
      src,
    ),
    "the eager move-task sections prefetch must be gated on nonEssentialReady",
  );
});

test("HTPR-6047: deferrable hooks accept an enabled input that defaults true", () => {
  const shareLinks = fs.readFileSync(
    path.join(__dirname, "..", "src/hooks/Task Detail/useGetShareLinks.ts"),
    "utf8",
  );
  assert.ok(
    /enabled\s*=\s*true/.test(shareLinks) && /enabled,?\s*\n?\s*\}\);/.test(shareLinks),
    "useGetTaskShareLinks must accept an enabled param (default true) and pass it to useQuery",
  );

  const moveSections = fs.readFileSync(
    path.join(__dirname, "..", "src/hooks/MultiPages/useGetSectionsMoveTask.ts"),
    "utf8",
  );
  assert.ok(
    /enabled\s*=\s*true/.test(moveSections) &&
      /Number\.isFinite\(projectId\)\s*&&\s*enabled/.test(moveSections),
    "useGetSectionsMoveTask must accept an enabled param (default true) and AND it into its own enabled check",
  );
});

test("HTPR-6047: the non-essential gate fails open on a short timer, independent of the 30s readiness measurement", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/app/detail/[...slug]/TaskDetailComp.tsx"),
    "utf8",
  );
  // A share view, a task with no description editor, a permission-limited
  // view, or an error state never satisfies taskDetailUsableDomPresent, so
  // without this the gate would only flip on the 30s readiness timeout -
  // stalling AI suggestions, the share link and move-task sections that long.
  assert.ok(
    /setTimeout\(\s*\(\)\s*=>\s*setNonEssentialReady\(true\),\s*3000,?\s*\)/.test(
      src,
    ),
    "a setTimeout must flip the gate true after 3s, independent of publish()'s 30s readiness timer",
  );
  assert.ok(
    /clearTimeout\(nonEssentialFallback\)/.test(src),
    "the 3s fallback timer must be cleared in cleanup so it doesn't fire after the real readiness publish already ran",
  );
});

test("HTPR-6047: WelcomeScreen gates AI task-questions/sessions on task-detail readiness", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src/components/AI_CHAT/WelcomeScreen.tsx"),
    "utf8",
  );
  assert.ok(
    /taskDetailDataReady\s*=\s*!isDetailPage\s*\|\|\s*taskDetailNonEssentialReady/.test(
      src,
    ),
    "off the task-detail page the gate must be a no-op (always ready)",
  );
  const taskQuestionsEnabled = (src.match(
    /enabled:\s*Boolean\(taskId\)\s*&&\s*taskDetailDataReady,/g,
  ) || []).length;
  assert.equal(
    taskQuestionsEnabled,
    2,
    "both the task-questions and task-sessions queries must gate on taskDetailDataReady",
  );
});
