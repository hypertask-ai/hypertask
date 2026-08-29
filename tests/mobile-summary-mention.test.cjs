const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("touch mentions commit on touchend and suppress the compatibility click", () => {
  const mentionSource = read("src/components/RTE/MentionList.jsx");

  assert.match(
    mentionSource,
    /onPointerDown=\{\(e\) => pointerSelectHandler\(e, index\)\}/,
  );
  assert.match(
    mentionSource,
    /if \(event\.pointerType !== "touch"\) selectItem\(index\)/,
  );
  assert.match(
    mentionSource,
    /onTouchEnd=\{\(e\) => touchSelectHandler\(e, index\)\}/,
  );
  assert.match(
    mentionSource,
    /const touchSelectHandler = \(event, index\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?selectItem\(index\);/,
  );
  assert.doesNotMatch(mentionSource, /onClick=\{\(e\) => clickSelectHandler/);
});

test("touch scrolling does not select a mention", () => {
  const mentionSource = read("src/components/RTE/MentionList.jsx");

  assert.match(mentionSource, /onTouchStart=\{touchStartHandler\}/);
  assert.match(mentionSource, /onTouchMove=\{touchMoveHandler\}/);
  assert.match(mentionSource, /onTouchCancel=\{touchCancelHandler\}/);
  assert.match(
    mentionSource,
    /const isTap = touchGestureRef\.current\?\.moved === false;[\s\S]*?if \(isTap\) selectItem\(index\);/,
  );
});
