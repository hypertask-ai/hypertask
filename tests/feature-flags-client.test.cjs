const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const filename = path.join(__dirname, "../src/hooks/useFlag.tsx");
const source = fs.readFileSync(filename, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: filename,
}).outputText;
let queryOptions;

const originalLoad = Module._load;
Module._load = (request, parent, isMain) => {
  if (request === "react") {
    return {
      createContext: () => ({ Provider: ({ children }) => children }),
      useContext: () => ({}),
      useEffect: () => {},
      useState: (initial) => [initial, () => {}],
    };
  }
  if (request === "react/jsx-runtime") {
    return { jsx: (type, props) => ({ type, props }) };
  }
  if (request === "@tanstack/react-query") {
    return {
      useQuery: (options) => {
        queryOptions = options;
        return { data: {} };
      },
      useQueryClient: () => ({}),
    };
  }
  if (request.startsWith("@/lib/realtime/")) {
    return {
      connectRealtimeClient: async () => null,
      releaseRealtimeClientIfIdle: () => {},
      FEATURE_FLAGS_EVENT: "feature-flags:changed",
      featureFlagsChannel: () => "private-feature-flags",
    };
  }
  return originalLoad(request, parent, isMain);
};

const hookModule = new Module(filename, module);
try {
  hookModule._compile(compiled, filename);
} finally {
  Module._load = originalLoad;
}

const { FeatureFlagProvider } = hookModule.exports;

test("feature flag fallback polling runs once per minute", () => {
  FeatureFlagProvider({ children: null, userId: 6 });

  assert.equal(queryOptions.refetchInterval, 60_000);
  assert.equal(queryOptions.refetchIntervalInBackground, true);
});
