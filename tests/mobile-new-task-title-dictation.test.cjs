const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src") },
});
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const { appendTitleDictation } = jiti(
  path.join(root, "src/components/Modals/CreateTaskGloballyModal/titleDictation.ts"),
);
const { createDictationCoordinator } = jiti(
  path.join(root, "src/lib/dictationCoordinator.ts"),
);

const originalCache = new Map(Object.entries(require.cache));
let createTaskModalValue;
const stubModule = (filename, exports) => {
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};
const stubSourceModule = (relativePath, exports) =>
  stubModule(path.join(root, relativePath), exports);

stubSourceModule("src/components/Common/Tooltip.tsx", { default: () => null });
stubSourceModule("src/lib/contexts/deviceContext.tsx", {
  useDeviceContext: () => false,
});
stubSourceModule("src/lib/state.tsx", {
  useRecoilValue: () => null,
});
stubSourceModule("src/store/index.ts", {
  currentProjectAtom: {},
});
stubSourceModule("src/hooks/Task Detail/useSetStickyHeight.ts", {
  default: () => ({ dynamicElementRef: React.createRef() }),
});
stubSourceModule("src/hooks/MultiPages/useClickOutside.ts", {
  default: () => {},
});
stubSourceModule("src/hooks/General/useAutosizeTextarea.ts", {
  default: () => {},
});
stubSourceModule("src/lib/tours/context/TourContext.tsx", {
  useTourContext: () => ({ endTour: () => {} }),
});
stubSourceModule(
  "src/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal.tsx",
  { useContextCreateTaskModal: () => createTaskModalValue },
);

const { MobileViewContext } = jiti(
  path.join(root, "src/lib/contexts/mobileContext.tsx"),
);
const { AudioButton } = jiti(
  path.join(root, "src/components/RTE/Components/AudioButton.tsx"),
);
const taskTitleModule = jiti(
  path.join(root, "src/components/Modals/CreateTaskGloballyModal/TaskTitleModal.tsx"),
);
const TaskTitleModal = taskTitleModule.default ?? taskTitleModule;

for (const filename of Object.keys(require.cache)) {
  if (!originalCache.has(filename)) delete require.cache[filename];
}
for (const [filename, cachedModule] of originalCache) {
  require.cache[filename] = cachedModule;
}

const withDom = async (callback) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai",
  });
  const previous = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
    localStorage: global.localStorage,
    MediaRecorder: global.MediaRecorder,
    requestAnimationFrame: global.requestAnimationFrame,
    cancelAnimationFrame: global.cancelAnimationFrame,
    actEnvironment: global.IS_REACT_ACT_ENVIRONMENT,
  };
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.localStorage = dom.window.localStorage;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};

  const container = document.getElementById("root");
  const reactRoot = createRoot(container);
  try {
    await callback({ container, reactRoot, dom });
  } finally {
    await act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      const globalKey = key === "actEnvironment" ? "IS_REACT_ACT_ENVIRONMENT" : key;
      if (value === undefined) delete global[globalKey];
      else global[globalKey] = value;
    }
  }
};

test("title dictation appends to the latest typed title without changing its text", () => {
  assert.equal(appendTitleDictation("Ship mobile", "dictation icon"), "Ship mobile dictation icon");
  assert.equal(appendTitleDictation("Ship mobile ", " dictation icon "), "Ship mobile dictation icon");
  assert.equal(appendTitleDictation("", "  New title  "), "New title");
  assert.equal(appendTitleDictation("Typed while waiting", "   "), "Typed while waiting");
});

test("dictation coordinator rejects peers and ignores stale releases", () => {
  const busyStates = [];
  const coordinator = createDictationCoordinator((busy) => busyStates.push(busy));
  const titleLease = coordinator.acquire();

  assert.ok(titleLease);
  assert.equal(coordinator.acquire(), null, "description cannot start while title owns dictation");
  assert.equal(coordinator.release(Symbol("stale")), false);
  assert.equal(coordinator.owns(titleLease), true, "stale cleanup cannot release the active owner");
  assert.equal(coordinator.release(titleLease), true);

  const descriptionLease = coordinator.acquire();
  assert.ok(descriptionLease);
  assert.equal(coordinator.owns(titleLease), false, "late title delivery is stale after release");
  assert.equal(coordinator.owns(descriptionLease), true);
  assert.deepEqual(busyStates, [true, false, true]);
});

test("new-task title renders one accessible mobile recorder and none on desktop", async () => {
  await withDom(async ({ container, reactRoot }) => {
    const coordinator = createDictationCoordinator(() => {});
    const noop = () => {};
    createTaskModalValue = {
      currentFocusedElement: null,
      editMode: "title",
      setEditMode: noop,
      formValues: { title: "Typed title" },
      handleChange: noop,
      appendDictationToTitle: noop,
      dictationCoordinator: coordinator,
      setCurrentFocusedElement: noop,
      focusOn: noop,
      isRecording: false,
      toggleRecording: noop,
      closeHandler: noop,
      isGeneratingTitle: false,
      titleGenerationError: null,
    };

    const renderTitle = (mobile) =>
      React.createElement(
        MobileViewContext.Provider,
        { value: mobile },
        React.createElement(TaskTitleModal),
      );

    await act(async () => reactRoot.render(renderTitle(true)));
    const titleMics = container.querySelectorAll("#create-task-title-audio-button");
    assert.equal(titleMics.length, 1);
    assert.equal(titleMics[0].getAttribute("role"), "button");
    assert.equal(titleMics[0].getAttribute("aria-label"), "Dictate task title");
    assert.match(titleMics[0].className, /h-11 w-11/);

    await act(async () => reactRoot.render(renderTitle(false)));
    assert.equal(container.querySelector("#create-task-title-audio-button"), null);
  });
});

test("a real recorder blocks its peer before microphone permission resolves", async () => {
  await withDom(async ({ container, reactRoot, dom }) => {
    let resolvePermission;
    let getUserMediaCalls = 0;
    let stoppedTracks = 0;
    const permission = new Promise((resolve) => {
      resolvePermission = resolve;
    });
    Object.defineProperty(global.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          getUserMediaCalls += 1;
          return permission;
        },
      },
    });

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      constructor(stream, options) {
        this.stream = stream;
        this.mimeType = options?.mimeType;
      }
      addEventListener() {}
      start() {}
    }
    global.MediaRecorder = FakeMediaRecorder;
    global.requestAnimationFrame = () => 1;
    global.cancelAnimationFrame = () => {};

    const busyStates = [];
    const coordinator = createDictationCoordinator((busy) => busyStates.push(busy));
    const recorder = (id, label) =>
      React.createElement(AudioButton, {
        callbackHandler: () => {},
        editor: null,
        id,
        toggleRecording: () => {},
        dictationCoordinator: coordinator,
        ariaLabel: label,
        mobilePresentation: "compact",
      });

    await act(async () =>
      reactRoot.render(
        React.createElement(
          MobileViewContext.Provider,
          { value: true },
          recorder("title-recorder", "Dictate task title"),
          recorder("description-recorder", "Dictate description"),
        ),
      ),
    );

    container
      .querySelector("#title-recorder")
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    container
      .querySelector("#description-recorder")
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    assert.equal(getUserMediaCalls, 1);
    assert.deepEqual(busyStates, [true]);

    await act(async () => {
      resolvePermission({
        getTracks: () => [{ stop: () => { stoppedTracks += 1; } }],
      });
      await permission;
    });
    assert.equal(getUserMediaCalls, 1);

    await act(async () => reactRoot.render(null));
    assert.equal(stoppedTracks, 1);
    assert.deepEqual(busyStates, [true, false]);
  });
});

test("modal plumbing passes its coordinator through the description recorder", () => {
  const tiptap = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  const modalState = read("src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts");

  assert.match(
    modalState,
    /setFormValues\(\(current\) => \(\{[\s\S]*?appendTitleDictation\(current\.title, transcript\)/,
  );
  assert.match(tiptap, /<AttachmentsUpload[\s\S]*?dictationCoordinator=\{dictationCoordinator\}/);
});
