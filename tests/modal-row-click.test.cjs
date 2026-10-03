const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const commonFile = "src/components/Common/CommonModalComponents/index.tsx";
const editBoardFile = "src/components/Modals/commands/editBoard.tsx";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadComponent(file, stubs) {
  const source = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", source)(
    mod, mod.exports, (request) => {
      assert.ok(request in stubs, `Unexpected import: ${request}`);
      return stubs[request];
    },
  );
  return mod.exports;
}

const common = loadComponent(commonFile, {
  "react/jsx-runtime": require("react/jsx-runtime"),
  react: require("react"),
  reactstrap: {},
  "@/utils/undoActions/helperFuncs": { cn: (...args) => args.join(" ") },
  "@/styles/linksModal.module.scss": {},
  "@/hooks/MultiPages/useClickOutside": {},
});

for (const handler of [undefined, null, false, "not a function", {}]) {
  test(`modal row tolerates ${JSON.stringify(handler)} handlers`, () => {
    const row = common.ModalRowElementContainer({ onClick: handler, index: 3 });
    assert.doesNotThrow(() => row.props.onClick());
  });
}

test("modal row passes its index to a valid handler", () => {
  const calls = [];
  common.ModalRowElementContainer({
    index: 3,
    onClick: (index) => calls.push(index),
  }).props.onClick();
  common.ModalRowElementContainer({
    onClick: (index) => calls.push(index),
  }).props.onClick();
  assert.deepEqual(calls, [3, undefined]);
});

function findElement(element, type) {
  if (!element || typeof element !== "object") return undefined;
  if (element.type === type) return element;
  for (const child of [element.props?.children].flat()) {
    const found = findElement(child, type);
    if (found) return found;
  }
}

test("rename board row submits the input just like Enter and rejects an empty name", () => {
  let title = "";
  const EditBoard = loadComponent(editBoardFile, {
    "react/jsx-runtime": require("react/jsx-runtime"),
    react: { useState: () => [title, (value) => { title = value; }] },
    "@/components/Common/CommonModalComponents": common,
  }).default;
  const updates = [];
  const render = () => EditBoard({ updateBoard: (value) => updates.push(value) });
  const click = (tree) => common.ModalRowElementContainer(
    findElement(tree, common.ModalRowElementContainer).props,
  ).props.onClick();

  click(render());
  assert.deepEqual(updates, []);
  findElement(render(), common.ModalInput).props.onChange({
    target: { value: "Renamed board" },
  });
  const tree = render();
  click(tree);
  assert.deepEqual(updates, ["Renamed board"]);
  findElement(tree, common.ModalInput).props.onKeyDown({ key: "Enter" });
  assert.deepEqual(updates, ["Renamed board", "Renamed board"]);
});

function missingHandlers(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const missing = [];
  const visit = (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && node.tagName.getText(file) === "ModalRowElementContainer"
      && !node.attributes.properties.some((prop) => ts.isJsxAttribute(prop)
        && prop.name.getText(file) === "onClick" && prop.initializer)) {
      missing.push(`${filename}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return missing;
}

test("every active modal row usage explicitly supplies a click handler", () => {
  assert.equal(missingHandlers("<ModalRowElementContainer />", "control.tsx").length, 1);
  assert.deepEqual(missingHandlers("<ModalRowElementContainer onClick={() => {}} />", "control.tsx"), []);
  const missing = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file)) {
        missing.push(...missingHandlers(fs.readFileSync(file, "utf8"), file));
      }
    }
  };
  walk(path.join(root, "src/components/Modals"));
  assert.deepEqual(missing, []);
});
