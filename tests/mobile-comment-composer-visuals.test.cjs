// HTPR-5565. Three visual defects in the mobile comment composer, each with a
// distinct root cause in a different file:
//
//  1. Composer text rendered larger than the rest of the app. The mobile
//     new-comment branch is the ONLY place that does not receive
//     styles.hellow, and `.editorContainer p { font-size: 14px }` is nested
//     under `.hellow` — so the composer fell back to the 16px editor base.
//  2. The send arrow was invisible on light themes. IOSend hardcoded
//     fill="white" on the arrow path while the circle behind it is
//     fill-hover-active (#eeeef1 on porcelain), i.e. white on near-white.
//     The button already sets text-white-black, so currentColor is correct.
//  3. The empty-state microphone used a round pill, out of line with the
//     mobile button style direction (HTPR-5517). It stays purple and primary
//     when empty (HTPR-5423) but is rectangular.
//
// The repo has no component-render or screenshot harness, so these are
// asserted against source, following tests/comment-field-divider.test.cjs.
// Each assertion is pinned to a durable fact rather than to formatting: the
// font-size test resolves the `text-content` token through tailwind.config so
// a retuned token fails here, and the send-arrow test isolates the arrow path
// by its own `d` geometry rather than by a byte offset.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const editor = read("src/components/RTE/Components/TiptapEditor.tsx");
const attachments = read("src/components/Common/AttachmentsUpload/index.tsx");
const audioButton = read("src/components/RTE/Components/AudioButton.tsx");
const tiptapStyles = read("src/styles/tiptap.module.scss");
const mainContainer = read("src/components/RTE/Components/TiptapMainContainer.tsx");
const tailwindConfig = read("tailwind.config.ts");

// The `d` of the send chevron. Identifies the arrow path wherever it moves to
// inside IOSend, so the fill assertion cannot drift onto a different element.
const SEND_ARROW_GEOMETRY = "M26.7598 78.28V58.72L52.8398 52.2L26.7598 45.68V26.12L88.6998 52.2L26.7598 78.28Z";

test("the text-content token is still the app's 14px body size", () => {
  // The composer fix leans on this token. If it is ever retuned, the composer
  // silently stops matching the rest of the app, so pin it here.
  assert.match(tailwindConfig, /"content"\s*:\s*"14px"/);
});

test("mobile comment composer text uses the app's content size", () => {
  // The premise of the fix: the 14px paragraph rule lives under .hellow...
  assert.match(tiptapStyles, /\.editorContainer\s*\{/);
  assert.match(tiptapStyles, /p\s*\{[^}]*font-size:\s*14px/);
  // ...and the mobile create-comment branch is the one place that omits it,
  // which is why the rule never applied to the composer.
  const mobileBranch = mainContainer.slice(
    mainContainer.indexOf("// FOR: New comment on mobile"),
    mainContainer.indexOf("// FOR: Description and old comment."),
  );
  assert.ok(mobileBranch.length > 0, "mobile create-comment branch not found");
  // Whitespace-normalised so reformatting cannot break this: inside the mobile
  // composer, .hellow is applied to everything EXCEPT id "comment-input", which
  // is precisely why the 14px rule never reached the new-comment editor.
  const flat = mobileBranch.replace(/\s+/g, " ");
  assert.match(flat, /id === "comment-input" \? "" : `\$\{styles\.hellow\}/);
  // So the composer container has to carry the size itself.
  const commentBranch = editor.slice(editor.indexOf('id === "comment-input"'));
  assert.match(commentBranch, /\btext-content\b/);
});

test("mobile send arrow inherits the button colour instead of hardcoding white", () => {
  // HTPR-5684 retired IOSend for the shared SendArrow. HTPR-5659 keeps Send
  // the same neutral colour as the demoted mic, so the arrow must track
  // currentColor (not a hardcoded white that vanishes on light themes).
  const arrowStart = attachments.indexOf("export const SendArrow");
  assert.ok(arrowStart > -1, "SendArrow not found");
  const arrow = attachments.slice(arrowStart);
  const arrowAt = arrow.indexOf(SEND_ARROW_GEOMETRY);
  assert.ok(arrowAt > -1, "send arrow path geometry not found in SendArrow");
  assert.match(arrow.slice(0, arrowAt), /fill="currentColor"/);
  assert.doesNotMatch(arrow.slice(0, arrowAt), /fill="white"/);
  const button = attachments.match(
    /aria-label="Send comment"[\s\S]{0,500}?className="([^"]+)"/,
  );
  assert.ok(button, "Send button not found");
  assert.match(button[1], /text-icon-dark-gray/);
  assert.doesNotMatch(button[1], /bg-hypertasks-ai-purple/);
  assert.doesNotMatch(button[1], /(?:^|\s)text-white(?:\s|$)/);
});

test("mobile create-comment uses AppSheet for both refine and compose", () => {
  const mobileBranch = mainContainer.slice(
    mainContainer.indexOf("// FOR: New comment on mobile"),
    mainContainer.indexOf("// FOR: Description and old comment."),
  );
  const inlineDraftAi = read("src/components/RTE/Components/InlineDraftAiFloat.tsx");
  assert.match(mobileBranch, /aiRefineOpen/);
  assert.match(mobileBranch, /presentation="refine-fullscreen"/);
  assert.match(mobileBranch, /!aiRefineOpen && !aiComposeOpen && <TiptapEditor/);
  assert.match(mobileBranch, /!editor\.isEmpty/);
  assert.match(mobileBranch, /aiComposeOpen/);
  assert.match(mobileBranch, /presentation="composer"/);
  assert.match(mobileBranch, /editor\.isEmpty/);
  assert.match(mobileBranch, /toggleAiTaskWriter=\{toggleAiTaskWriter\}/);
  assert.doesNotMatch(mobileBranch, /MobileBottomSheet/);
  assert.match(inlineDraftAi, /AppSheet/);
  assert.match(inlineDraftAi, /mobileOverlayAppSheetPanelClass/);
  assert.match(inlineDraftAi, /EditorContent editor=\{editor\}/);
  assert.match(inlineDraftAi, /isRefineFullscreen \|\| isComposer/);
  assert.match(inlineDraftAi, /mobileOverlayAppSheetEditorWellClass/);
  assert.match(inlineDraftAi, /editorHasText/);
  assert.match(inlineDraftAi, /getMobileOverlaySheetContainerStyle/);
  assert.match(inlineDraftAi, /onOpenEnd=\{focusEditorInSheet\}/);
  assert.doesNotMatch(inlineDraftAi, /createPortal/);
});

test("empty-state mobile comment microphone is rectangular, still purple", () => {
  // Class order inside the string is incidental; presence of both is not.
  const branch = audioButton.match(
    /isMobileCreateComment\s*\?\s*"([^"]*)"/,
  );
  assert.ok(branch, "isMobileCreateComment class branch not found");
  assert.match(branch[1], /\brounded-sm\b/);
  assert.doesNotMatch(branch[1], /\brounded-full\b/);
  assert.match(branch[1], /\bbg-hypertasks-ai-purple\b/);
});
