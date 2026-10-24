const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function load(file, mocks = {}) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", js)((name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const flag = load("src/lib/flags/definitions/htpr-7749-header-icon-size.ts");
const directory = "src/components/PageComponents/TaskDetail/TaskOptions/";
const noop = () => {};
const jsx = (type, props) => ({ type, props: props ?? {} });

function header({ enabled = true, mobile = false, notifications = 1, status = "Normal" } = {}) {
  const mocks = {
    "react": {
      useContext: () => mobile,
      useState: (value) => [value, noop],
      useRef: (value) => ({ current: value }),
      useEffect: noop,
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "lucide-react": { Archive: "Archive", CircleCheck: "CircleCheck", Clock: "Clock" },
    "next/image": "Image",
    "next/navigation": { useSearchParams: () => new URLSearchParams() },
    "@/components/Common/Tooltip": "Tooltip",
    "@/lib/contexts/TaskDetail/TaskProvider": {
      useTaskContext: () => ({ currentTask: { status, _count: { notifications } }, setShowRemindMeModal: noop }),
    },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/contexts/mobileContext": { MobileViewContext: "mobile" },
    "@/lib/configs/general.config": { TOUCH_HALO: "touch-halo" },
    "@/lib/taskDetailArchiveControl": load("src/lib/taskDetailArchiveControl.ts"),
    "@/lib/taskDetailArchiveActions": load("src/lib/taskDetailArchiveActions.ts"),
    "@/lib/constants": { gThenKeyDelay: 500 },
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => false },
    "@/lib/state": { useRecoilState: () => [null, noop] },
    "@/store": { showCommandsAtom: "commands" },
    "@/models/enums": { CommandMode: { Command: "Command" } },
    "@/hooks/MultiPages/HTC/useDarkMode": () => ({ effectiveTheme: "dark" }),
    "@/hooks/Task Detail/useArchiveAndNavigate": () => ({ markAsDone: noop, navigateToNextTask: noop }),
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, flag.HTPR_7749_HEADER_ICON_SIZE_FLAG); return enabled; } },
    "@/lib/flags/definitions/htpr-7749-header-icon-size": flag,
    "./ShareTaskButton": "Share",
  };
  const components = {};
  for (const name of ["ArchiveTaskNotifications", "MarkTaskAsDone", "RemindMeTaskDetail", "HTCButton"]) {
    const component = load(`${directory}${name}.tsx`, mocks).default;
    components[name] = component;
    mocks[`./${name}`] = component;
  }
  components.TaskOptions = load(`${directory}TaskOptions.tsx`, mocks).default;
  return components;
}

function elements(node) {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (typeof node.type === "function") return elements(node.type(node.props));
  return [node, ...elements(node.props.children)];
}

function icon(nodes, type) {
  const matches = nodes.filter((node) => node.type === type);
  assert.equal(matches.length, 1, `Expected one ${type}`);
  return matches[0].props;
}

for (const mobile of [false, true]) {
  test(`flag on uses shared 20px header icons and preserves the mobile command image (${mobile ? "phone" : "desktop"})`, () => {
    const components = header({ mobile });
    const nodes = elements([
      components.ArchiveTaskNotifications({ selected: true, navigateToNextTask: noop }),
      components.MarkTaskAsDone({ markAsDone: noop }),
      components.RemindMeTaskDetail({ isHeader: true, navigateToNextTask: noop }),
      components.HTCButton({}),
    ]);
    for (const type of ["Archive", "CircleCheck", "Clock"]) {
      const props = icon(nodes, type);
      assert.equal(props.size, 20);
      assert.equal(props.strokeWidth, 1.75);
      assert.match(props.className, /\bkeep-stroke\b/);
      assert.doesNotMatch(props.className, /\b[hw]-\[/);
    }
    assert.equal(icon(nodes, "Clock").className, "keep-stroke task-option-icon text-[#696b6e] hover:text-[#95999e]");
    const image = icon(nodes, "Image");
    assert.equal(image.width, mobile ? 18 : 20);
    assert.equal(image.height, mobile ? 14 : 20);
    if (mobile) assert.equal(image.className, undefined);
    else assert.equal(image.className, "h-5 w-5 object-contain");
  });

  test(`flag off keeps the original sizes and stroke classes (${mobile ? "phone" : "desktop"})`, () => {
    const components = header({ enabled: false, mobile });
    const nodes = elements([
      components.ArchiveTaskNotifications({ selected: true, navigateToNextTask: noop }),
      components.MarkTaskAsDone({ markAsDone: noop }),
      components.RemindMeTaskDetail({ isHeader: true, navigateToNextTask: noop }),
      components.HTCButton({}),
    ]);
    for (const type of ["Archive", "CircleCheck"]) {
      assert.equal(icon(nodes, type).size, 20);
      assert.match(icon(nodes, type).className, /\bkeep-stroke\b/);
    }
    const clock = icon(nodes, "Clock");
    assert.equal(clock.size, 18);
    assert.equal(clock.className, "h-[18px] w-[18px] task-option-icon text-[#696b6e] hover:text-[#95999e]");
    assert.doesNotMatch(clock.className, /\bkeep-stroke\b/);
    for (const type of ["Archive", "CircleCheck", "Clock"]) assert.equal(icon(nodes, type).strokeWidth, 1.75);
    const image = icon(nodes, "Image");
    assert.equal(image.width, mobile ? 18 : 16);
    assert.equal(image.height, mobile ? 14 : 16);
    assert.equal(image.className, undefined);
  });
}

for (const enabled of [false, true]) {
  test(`the desktop header wires all four controls with flag ${enabled ? "on" : "off"}`, () => {
    const { TaskOptions } = header({ enabled });
    const nodes = elements(TaskOptions());
    assert.equal(icon(nodes, "Archive").size, 20);
    assert.equal(icon(nodes, "CircleCheck").size, 20);
    assert.equal(icon(nodes, "Clock").size, enabled ? 20 : 18);
    assert.equal(icon(nodes, "Image").width, enabled ? 20 : 16);
    assert.equal(icon(nodes, "Image").height, enabled ? 20 : 16);
    assert.equal(icon(nodes, "Image").className, enabled ? "h-5 w-5 object-contain" : undefined);
    assert.equal(nodes.filter((node) => node.type === "Share").length, 1);
  });

  test(`the phone header preserves its existing controls with flag ${enabled ? "on" : "off"}`, () => {
    const { TaskOptions } = header({ enabled, mobile: true });
    const nodes = elements(TaskOptions());
    assert.equal(icon(nodes, "CircleCheck").size, 20);
    assert.equal(nodes.filter((node) => node.type === "Share").length, 1);
    assert.deepEqual(nodes.filter((node) => ["Archive", "Clock", "Image"].includes(node.type)), []);
  });
}

for (const mobile of [false, true]) {
  test(`non-header reminder and kanban command icons keep their original sizes (${mobile ? "phone" : "desktop"})`, () => {
    const { RemindMeTaskDetail, HTCButton } = header({ mobile });
    const reminder = icon(elements(RemindMeTaskDetail({ navigateToNextTask: noop, children: "Snooze" })), "Clock");
    assert.equal(reminder.size, 18);
    assert.equal(reminder.className, "task-option-icon h-[18px] w-[18px] text-[#696b6e] hover:text-[#95999e]");
    const command = icon(elements(HTCButton({ isKanban: true })), "Image");
    assert.equal(command.width, mobile ? 18 : 16);
    assert.equal(command.height, mobile ? 14 : 16);
    assert.equal(command.className, undefined);
  });
}

test("no notification still means no remove-notification icon", () => {
  const { TaskOptions } = header({ notifications: 0 });
  const nodes = elements(TaskOptions());
  assert.equal(nodes.filter((node) => node.type === "Archive").length, 0);
  assert.equal(icon(nodes, "CircleCheck").size, 20);
});

test("archived tasks retain the archived indicator", () => {
  const { MarkTaskAsDone } = header({ status: "Archive" });
  const props = icon(elements(MarkTaskAsDone({ markAsDone: noop })), "CircleCheck");
  assert.equal(props.size, 20);
  assert.match(props.className, /\btask-archived-indicator\b/);
});

test("bugfix flag is on for Everyone with the requested shipped date and release-risk reason", () => {
  const definition = flag.default;
  assert.equal(flag.HTPR_7749_HEADER_ICON_SIZE_FLAG, "htpr-7749-header-icon-size");
  assert.equal(definition.key, flag.HTPR_7749_HEADER_ICON_SIZE_FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-24");
  assert.match(definition.description, /20px header size/);
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});
