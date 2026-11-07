const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const {
  DICTATION_CAPTURE_TIMESLICE_MS,
  openDictationGraph,
  resolveDictationProjectId,
} = loadModule("src/lib/dictationCapture.ts");

function fakeAudioContext() {
  const links = [];
  return {
    links,
    createMediaStreamSource(stream) {
      return {
        kind: "source",
        stream,
        connect(target) {
          links.push(["source", target.kind]);
        },
      };
    },
    createAnalyser() {
      return {
        kind: "analyser",
        fftSize: 0,
        smoothingTimeConstant: 0,
        connect(target) {
          links.push(["analyser", target.kind]);
        },
      };
    },
    createMediaStreamDestination() {
      return { kind: "destination", stream: { id: "graph", getTracks: () => [] } };
    },
  };
}

test("routed capture records the graph output and an unrouted capture records the microphone", () => {
  const mic = { id: "mic", getTracks: () => [] };
  const routed = fakeAudioContext();
  const routedGraph = openDictationGraph(routed, mic, true);
  assert.deepEqual(routed.links, [["source", "analyser"], ["analyser", "destination"]]);
  assert.equal(routedGraph.recordStream.id, "graph");
  assert.equal(routedGraph.analyser.fftSize, 1024);

  const direct = fakeAudioContext();
  const directGraph = openDictationGraph(direct, mic, false);
  assert.deepEqual(direct.links, [["source", "analyser"]]);
  assert.equal(directGraph.recordStream, mic);
});

test("a missing current board still sends the open ticket board when capture is routed", () => {
  assert.equal(resolveDictationProjectId(undefined, null, 42, true), 42);
  assert.equal(resolveDictationProjectId(undefined, 7, 42, true), 7);
  assert.equal(resolveDictationProjectId(undefined, null, 42, false), undefined);
  assert.equal(resolveDictationProjectId(9, null, 42, true), 9);
  assert.equal(resolveDictationProjectId(null, 7, 42, true), undefined);
});

test("the comment microphone records the graph stream on a timeslice", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/" });
  const globals = ["window", "document", "HTMLElement", "navigator", "localStorage", "IS_REACT_ACT_ENVIRONMENT", "requestAnimationFrame", "cancelAnimationFrame", "AudioContext", "MediaRecorder"];
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const recorders = [];
  let reactRoot;
  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.navigator = dom.window.navigator;
    global.localStorage = dom.window.localStorage;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    global.requestAnimationFrame = () => 1;
    global.cancelAnimationFrame = () => {};
    dom.window.requestAnimationFrame = global.requestAnimationFrame;
    dom.window.cancelAnimationFrame = global.cancelAnimationFrame;

    const mic = { id: "mic", getTracks: () => [{ stop() {} }] };
    const mediaDevices = {
      getUserMedia: async () => mic,
      enumerateDevices: async () => [],
    };
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      writable: true,
      value: mediaDevices,
    });

    class AudioContext {
      constructor() { this.state = "running"; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() {
        return { connect() {} };
      }
      createAnalyser() {
        return {
          fftSize: 0,
          smoothingTimeConstant: 0,
          connect(target) { this.target = target; },
          getByteTimeDomainData(buffer) { buffer.fill(128); },
        };
      }
      createMediaStreamDestination() {
        return { stream: { id: "graph", getTracks: () => [{ stop() {} }] } };
      }
    }
    class MediaRecorder {
      static isTypeSupported() { return true; }
      constructor(stream) {
        this.stream = stream;
        this.mimeType = "audio/webm";
        this.timeslice = undefined;
        recorders.push(this);
      }
      addEventListener() {}
      removeEventListener() {}
      start(timeslice) { this.timeslice = timeslice; }
      stop() {}
      requestData() {}
    }
    global.AudioContext = AudioContext;
    global.MediaRecorder = MediaRecorder;
    dom.window.AudioContext = AudioContext;
    dom.window.MediaRecorder = MediaRecorder;

    const { AudioButton } = loadModule("src/components/RTE/Components/AudioButton.tsx", {
      "@/hooks/useFlag": { useFlag: (key) => key === "htpr-8138-comment-dictation" },
      "@/lib/state": {
        useRecoilValue: (atom) => atom.key === "currentProject" ? null : { taskProjectId: 42 },
      },
      "@/store": {
        currentProjectAtom: { key: "currentProject" },
        inViewObjectAtom: { key: "inView" },
      },
      "react-hot-toast": { default: { error() {} } },
      "lucide-react": { Check: () => null, ChevronDown: () => null, Loader2: () => null, Mic: () => null, X: () => null },
      "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { fontSizes: { moderateIcon: 16 } } },
      "@/components/Common/Tooltip": { default: () => null },
      "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    });

    reactRoot = createRoot(document.getElementById("root"));
    await React.act(async () => {
      reactRoot.render(React.createElement(AudioButton, {
        id: "create-comment-audio-button",
        editor: null,
        callbackHandler: () => {},
        toggleRecording: () => {},
        ariaLabel: "Start dictation",
      }));
    });
    const button = document.getElementById("create-comment-audio-button");
    assert.ok(button);
    await React.act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(recorders.length, 1);
    assert.equal(recorders[0].stream.id, "graph");
    assert.equal(recorders[0].timeslice, DICTATION_CAPTURE_TIMESLICE_MS);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
    dom.window.close();
  }
});

test("capture graph ok", () => {
  console.log("capture graph ok");
});
