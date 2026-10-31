const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const container = read(
  "src/components/PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer.tsx",
);
const input = read(
  "src/components/PageComponents/TaskDetail/AI Task Writer/AITaskWriterInputArea.tsx",
);
const audio = read("src/components/RTE/Components/AudioButton.tsx");
const autosize = read("src/hooks/General/useAutosizeTextarea.ts");
const appSheet = read("src/components/Modals/Sheets/AppSheet.tsx");
const jiti = require("jiti")(__filename, { interopDefault: true });
const { mobileMicPresentation } = jiti(
  path.join(
    root,
    "src/components/RTE/Components/mobileAudioButtonPresentation.ts",
  ),
);

test("mobile prompt focuses with a visible caret as the writer opens", () => {
  assert.match(container, /useLayoutEffect\(\(\) => \{/);
  assert.match(container, /prompt\.focus\(\{ preventScroll: true \}\)/);
  assert.match(
    container,
    /prompt\.setSelectionRange\(prompt\.value\.length, prompt\.value\.length\)/,
  );
  assert.match(
    container,
    /isWaitingForSeededPrompt[\s\S]*?!autoTrigger && Boolean\(initialPrompt\) && !userPrompt/,
  );
  assert.match(input, /autoFocus/);
  assert.match(input, /min-h-\[52px\][\s\S]*?text-\[16px\]/);
  assert.match(input, /caret-hypertasks-ai-purple/);
  assert.match(
    container,
    /onOpenEnd=\{\(\) => \{[\s\S]*?prompt\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(
    container,
    /onOpenStart=\{\(\) => \{[\s\S]*?prompt\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(
    container,
    /new MutationObserver\([\s\S]*?!mobilePromptCanFocus\.current[\s\S]*?observer\.disconnect\(\)[\s\S]*?getComputedStyle\(sheet\)\.visibility === "hidden"[\s\S]*?prompt\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(
    container,
    /observer\.observe\(sheet, \{[\s\S]*?attributeFilter: \["style", "class"\]/,
  );
  assert.match(container, /prompt\.closest\('\[role="dialog"\]'\)/);
  assert.match(
    container,
    /getComputedStyle\(sheet\)\.visibility !== "hidden"[\s\S]*?queueMicrotask\([\s\S]*?!mobilePromptCanFocus\.current[\s\S]*?prompt\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(appSheet, /"onCloseEnd" \| "onOpenStart" \| "onOpenEnd"/);
  assert.match(appSheet, /onOpenStart=\{onOpenStart\}/);
  assert.match(appSheet, /onOpenEnd=\{onOpenEnd\}/);
  assert.match(
    container,
    /onOpenEnd=\{\(\) => \{[\s\S]*?mobilePromptVisibilityObserver\.current\?\.disconnect\(\);[\s\S]*?if \(isLoading \|\| currentDisplayResponse \|\| !prompt\) return;/,
  );
});

test("mobile controls sit in a left-aligned row with the primary pushed right", () => {
  assert.match(container, /data-mobile-task-writer-composer/);
  assert.match(container, /isMobile \? "justify-start gap-1" : "justify-end"/);
  assert.match(
    container,
    /wrapperClassName=\{\s*isMobile && !userPrompt\.trim\(\) \? "ml-auto" : undefined\s*\}/,
  );
  assert.match(audio, /isMobileTaskWriter[\s\S]*?ai-writer-audio-button/);
  assert.match(
    audio,
    /import \{ mobileMicPresentation \} from "\.\/mobileAudioButtonPresentation"/,
  );
  const presentationStart = audio.indexOf("mobileMicPresentation({");
  const presentationEnd = audio.indexOf("});", presentationStart);
  const presentationCall = audio.slice(presentationStart, presentationEnd);
  assert.ok(presentationStart >= 0 && presentationEnd > presentationStart);
  for (const argument of [
    "isMobileCreateComment,",
    "isMobileTaskWriter,",
    "isMobileNewTask,",
    "isMobileAiChat,",
    "globalRecording,",
    "hasText,",
    "isProcessing,",
    "primaryTone: mobilePrimaryTone,",
  ]) {
    assert.match(presentationCall, new RegExp(argument));
  }
  assert.match(audio, /prominent \? prominentClassName : "h-\[32px\]"/);
  for (const mode of ["isMobileTaskWriter", "isMobileNewTask", "isMobileAiChat"]) {
    const presentation = mobileMicPresentation({
      isMobileCreateComment: false,
      isMobileTaskWriter: false,
      isMobileNewTask: false,
      isMobileAiChat: false,
      isProcessing: false,
      [mode]: true,
    });
    assert.equal(presentation.prominent, true);
    assert.match(presentation.className, /h-11 w-12/);
    assert.match(presentation.className, /bg-white-black/);
    assert.doesNotMatch(presentation.className, /bg-shadcn-primary/);
    assert.match(presentation.className, /text-white-black-inverted/);
  }
  assert.match(audio, /size=\{isMobileTaskWriter \|\| isMobileNewTask \? 20 : 18\}/);
  assert.match(audio, /aria-label=\{isMobileTaskWriter \? "Start dictation"/);
  assert.match(container, /aria-label=\{isMobile \? "Send prompt"/);
});

test("prompt growth remains bounded by the keyboard-visible viewport", () => {
  assert.match(container, /writerViewport\.visibleHeight \* 0\.32/);
  assert.match(container, /maxHeightPx: mobilePromptMaxHeight/);
  assert.match(container, /\},\s*mobilePromptMaxHeight,\s*\);/);
  assert.match(autosize, /let maxHeight = taskWriterDetails\.maxHeightPx/);
  assert.match(container, /prompt\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(container, /bottom: writerViewport\.bottomInset/);
  assert.match(container, /maxHeight: `\$\{writerViewport\.visibleHeight\}px`/);
  assert.match(container, /SheetScroller[\s\S]*?className="flex-1 min-h-0/);
  assert.match(
    appSheet,
    /export const SheetScroller[\s\S]*?className=\{cn\("overflow-y-auto", className\)\}/,
  );
});

test("desktop Task Writer retains its existing alignment and input styling", () => {
  assert.match(container, /: "justify-end"/);
  assert.match(
    input,
    /: "resize-none outline-none bg-inherit w-full py-2 border-none scrollbar-none placeholder:truncate"/,
  );
  assert.match(container, /if \(isMobile\) \{[\s\S]*?<AppSheet[\s\S]*?\n  return \(/);
});
