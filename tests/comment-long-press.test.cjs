const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const ts = require("typescript");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
});
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const { getAllCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts")
);
const { pinCommentGroupFirst } = jiti(
  path.join(root, "src/lib/htc/pinCommentGroupFirst.ts")
);
const { isCommentCreatedByUser } = jiti(
  path.join(root, "src/lib/htc/isCommentCreatedByUser.ts")
);

test("comment rows always use long press and cancel it on movement, release or unmount", (t) => {
  const source = fs.readFileSync(path.join(root,
    "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/SwipeableCommentRow.tsx"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let cleanup;
  const mocks = {
    react: {
      useRef: (current) => ({ current }),
      useEffect: (effect) => { cleanup = effect(); },
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
  };
  const exports = {};
  new Function("require", "exports", js)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  const previousWindow = global.window;
  t.after(() => { global.window = previousWindow; });
  let timer;
  global.window = {
    setTimeout: (callback, delay) => {
      assert.equal(delay, 500);
      timer = callback;
      return 1;
    },
    clearTimeout: () => { timer = null; },
  };
  let opened = 0;
  const row = exports.default({ children: "Comment", onMore: () => { opened++; } });
  const { props } = row;
  const press = { pointerType: "touch", pointerId: 1, clientX: 0, clientY: 0 };
  assert.equal(props.children, "Comment");
  assert.equal(props.onTouchMove, undefined);
  assert.equal(props.style.touchAction, "pan-y");
  props.onPointerDown(press);
  timer();
  assert.equal(opened, 1);
  let prevented = 0;
  const click = { preventDefault: () => { prevented++; }, stopPropagation: () => { prevented++; } };
  props.onClickCapture(click);
  assert.equal(prevented, 2);
  props.onClickCapture(click);
  assert.equal(prevented, 2);
  props.onPointerDown(press);
  props.onPointerMove({ ...press, clientX: 11 });
  assert.equal(timer, null);
  for (const cancel of [props.onPointerUp, props.onPointerCancel, cleanup]) {
    props.onPointerDown(press);
    assert.equal(typeof timer, "function");
    cancel();
    assert.equal(timer, null);
  }
  props.onPointerDown({ ...press, pointerType: "mouse", button: 2 });
  assert.equal(timer, null);
  assert.equal(opened, 1);
});

test("comment commands already list Edit comment first", () => {
  const groups = getAllCommands({
    context: "Task",
    commentOptions: {
      isApple: false,
      isCurrentUserCreator: true,
      isPinned: false,
      isStarred: false,
    },
  });
  assert.equal(groups[0].group, "Comment");
  assert.equal(groups[0].commandLists[0].key, "editcomment");
  assert.equal(groups[0].commandLists[0].commandMode, CommandMode.EditComment);
});

test("pinCommentGroupFirst puts Comment above Frequently used and leaves Edit first", () => {
  const comment = {
    group: "Comment",
    commandLists: [
      { key: "editcomment", name: "Edit comment" },
      { key: "deletemessage", name: "Delete comment" },
    ],
  };
  const frequentlyUsed = {
    group: "Frequently used",
    commandLists: [{ key: "createTask", name: "Create task" }],
  };
  const pinned = pinCommentGroupFirst([frequentlyUsed, comment]);
  assert.equal(pinned[0].group, "Comment");
  assert.equal(pinned[0].commandLists[0].key, "editcomment");
  assert.equal(pinned[1].group, "Frequently used");
});

test("pinCommentGroupFirst is a no-op when there is no Comment group", () => {
  const groups = [{ group: "Task", commandLists: [] }];
  assert.strictEqual(pinCommentGroupFirst(groups), groups);
});

test("own comment with only creator.id still lists Edit first", () => {
  const own = isCommentCreatedByUser({ creator: { id: 42 } }, 42);
  assert.equal(own, true);
  const groups = getAllCommands({
    context: "Task",
    commentOptions: {
      isApple: false,
      isCurrentUserCreator: own,
      isPinned: false,
      isStarred: false,
    },
  });
  assert.equal(groups[0].group, "Comment");
  assert.equal(groups[0].commandLists[0].key, "editcomment");
  assert.equal(groups[0].commandLists[0].name, "Edit comment");
});

test("creatorId-only match still counts as own comment", () => {
  assert.equal(isCommentCreatedByUser({ creatorId: 7 }, 7), true);
  assert.equal(isCommentCreatedByUser({ creatorId: "7" }, 7), true);
});

test("someone else's comment does not get Edit", () => {
  const own = isCommentCreatedByUser(
    { creatorId: 1, creator: { id: 1 } },
    42
  );
  assert.equal(own, false);
  const groups = getAllCommands({
    context: "Task",
    commentOptions: {
      isApple: false,
      isCurrentUserCreator: own,
      isPinned: false,
      isStarred: false,
    },
  });
  assert.notEqual(groups[0].commandLists[0].key, "editcomment");
});
