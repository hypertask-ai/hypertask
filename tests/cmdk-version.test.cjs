const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { getNextConfigEnv } = require("next/dist/lib/static-env");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paletteFile = "src/components/Modals/commands/HTC/commands.tsx";
const flag = "htpr-6892-cmdk-version";
const buildEnv = {
  NEXT_PUBLIC_BUILD_ID: "a91d4481234567890",
  NEXT_PUBLIC_BUILD_TIME: "2026-10-03T13:55:00.000Z",
};
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const noop = () => {};
const defaultExport = (value) => ({ __esModule: true, default: value });

// Exercise the real palette and shared UI, isolating only unrelated data/hooks and modal portals.
function renderPalette({ enabled = true, mobile = false, env = buildEnv, rows = 2 } = {}) {
  const atoms = {
    calendarSettingsAtom: { default: { showWeekends: true } },
    boardLayoutAtom: { default: "board" },
    showCommandsAtom: { default: { show: false, mode: 0 } },
  };
  const commands = [{ group: "Board", commandLists: Array.from({ length: rows }, (_, index) => ({
    key: index === 0 ? "createTask" : index === 1 ? "createBoard" : `command-${index}`,
    name: index === 0 ? "Create task" : index === 1 ? "Create board" : `Command ${index}`,
    commandMode: index + 1,
  })) }];
  const modal = ({ children, isOpen, className, contentClassName }) => isOpen
    ? React.createElement("div", { className: "modal show", style: { display: "block" } },
      React.createElement("div", { className: `modal-dialog ${className}` },
        React.createElement("div", { className: `modal-content ${contentClassName}` }, children)))
    : null;
  const mocks = {
    react: React,
    "react-dom": require("react-dom"),
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => "/project" },
    reactstrap: {
      Modal: modal,
      ModalBody: ({ children, className }) => React.createElement("div", { className: `modal-body ${className}` }, children),
    },
    "@/store": new Proxy(atoms, { get: (_, key) => atoms[key] ??= { default: key === "frequentlyUsedHTCAton" ? {} : null } }),
    "@/store/currentPageActions": { currentPageActionsAtom: { default: null } },
    "@/lib/state": {
      useRecoilState: (atom) => React.useState(atom.default),
      useRecoilValue: (atom) => atom.default,
    },
    "@/hooks/useFlag": { useFlag: (key) => enabled && key === flag, useAgentChatAllowed: () => false },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/lib/contexts/TourContext": { useTourContext: () => ({ endTour: noop }) },
    "@/hooks/MultiPages/useGetAllProjectsMinimal": { useGetAllProjectsMinimal: () => ({ data: [] }) },
    "@/hooks/RecoilRoot/useHypertasksRecoilStates": defaultExport(() => ({ resetShowCommands: noop })),
    "@/hooks/MultiPages/HTC/useHTC": defaultExport(() => ({ keyword: "", onKeyChange: noop, filterCommands: commands })),
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {
      getActiveEmptySectionSettingFromProject: () => "Shown", getActiveStalenessFromProject: () => false,
    },
    "./AllCommands": { getAllCommands: () => commands, getMobileCommandGroups: (groups) => groups, getBoardMenuCommands: (groups) => groups },
    "./MobileCommandIcon": { MobileCommandIcon: () => null },
    "./ComposeTaskWriter": defaultExport(() => null),
    "@/utils/getCurrentUser": { getCurrentUserFromCookies: () => null },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    nookies: {},
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/hooks/MultiPages/useClickOutside": defaultExport(noop),
    "@/components/PageComponents/Interactive-Onboarding/Components/TutorialTip": defaultExport(() => null),
    "@/components/Modals/Sheets": {
      MobileBottomSheet: ({ children, bottomSlot }) => React.createElement("div", { "data-mobile-sheet": "" }, children, bottomSlot),
    },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    let source = read(file);
    if (file === paletteFile) {
      for (const key of ["NEXT_PUBLIC_BUILD_ID", "NEXT_PUBLIC_BUILD_TIME"]) {
        source = source.replaceAll(`process.env.${key}`, JSON.stringify(env[key]) ?? "undefined");
      }
    }
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: file,
    }).outputText;
    const exports = {};
    cache.set(file, exports);
    new Function("require", "exports", "document", js)((specifier) => {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      if (specifier.endsWith(".scss")) return defaultExport({ links_modal: "links_modal" });
      if (specifier === "lucide-react") return require(specifier);
      const resolved = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : path.join(path.dirname(file), specifier);
      const target = [resolved + ".ts", resolved + ".tsx", resolved + "/index.tsx"].find((candidate) => fs.existsSync(path.join(root, candidate)));
      assert.ok(target, `Unexpected import: ${specifier} in ${file}`);
      return load(target);
    }, exports, { activeElement: null });
    return exports;
  }
  return renderToStaticMarkup(React.createElement(load(paletteFile).default, { isOpen: true }));
}

function buildConfig(env = {}, gitSha = "a91d448", gitAvailable = true) {
  const configModule = { exports: {} };
  new Function("require", "module", "process", "__dirname", read("next.config.js"))((specifier) => {
    if (["@next/bundle-analyzer", "next-pwa"].includes(specifier)) return () => (config) => config;
    if (specifier === "@posthog/nextjs-config") return { withPostHogConfig: (config) => config };
    if (specifier === "node:child_process") return { execFileSync: (_node, args, options) => {
      assert.deepEqual(args, ["scripts/generate-flag-index.mjs"]);
      assert.equal(options.cwd, root);
    } };
    if (specifier === "child_process") return { execSync: () => {
      if (!gitAvailable) throw new Error("No git checkout");
      return Buffer.from(gitSha);
    } };
    throw new Error(`Unexpected config import: ${specifier}`);
  }, configModule, { env, execPath: process.execPath }, root);
  return configModule.exports;
}

function footer(html) {
  const dom = new JSDOM(html);
  try { return dom.window.document.querySelector("[data-cmdk-version]")?.textContent ?? null; }
  finally { dom.window.close(); }
}

if (require.main === module) {
  test("flag off removes the line; the positive control actually renders it", () => {
    assert.ok(footer(renderPalette({ enabled: true })));
    assert.equal(footer(renderPalette({ enabled: false })), null);
  });

  test("flag on shows seven-character SHA and the viewer's local short-month time", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      assert.equal(footer(renderPalette()), "v a91d448 · 3 Oct 13:55");
      process.env.TZ = "America/New_York";
      assert.equal(footer(renderPalette()), "v a91d448 · 3 Oct 09:55");
      process.env.TZ = "Asia/Tokyo";
      assert.equal(footer(renderPalette()), "v a91d448 · 3 Oct 22:55");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  test("missing and invalid metadata never produces an invalid date", () => {
    assert.equal(footer(renderPalette({ env: {} })), "v dev");
    assert.equal(footer(renderPalette({ env: { NEXT_PUBLIC_BUILD_TIME: buildEnv.NEXT_PUBLIC_BUILD_TIME } })), "v dev");
    for (const time of [undefined, "", "not-a-date"]) {
      assert.equal(footer(renderPalette({ env: { ...buildEnv, NEXT_PUBLIC_BUILD_TIME: time } })), "v a91d448");
    }
  });

  test("mobile bottom sheet and its search/list remain identical with either flag mode", () => {
    assert.equal(renderPalette({ enabled: true, mobile: true }), renderPalette({ enabled: false, mobile: true }));
  });

  test("Vercel and git/prebuilt build paths supply Next's static client environment", () => {
    const before = Date.now();
    const config = buildConfig({ VERCEL_GIT_COMMIT_SHA: buildEnv.NEXT_PUBLIC_BUILD_ID, BUILD_ID: "older-build" });
    assert.equal(config.env.NEXT_PUBLIC_BUILD_ID, buildEnv.NEXT_PUBLIC_BUILD_ID);
    assert.ok(Date.parse(config.env.NEXT_PUBLIC_BUILD_TIME) >= before);
    assert.ok(Date.parse(config.env.NEXT_PUBLIC_BUILD_TIME) <= Date.now());
    const inlined = getNextConfigEnv(config);
    assert.equal(inlined["process.env.NEXT_PUBLIC_BUILD_ID"], buildEnv.NEXT_PUBLIC_BUILD_ID);
    assert.equal(inlined["process.env.NEXT_PUBLIC_BUILD_TIME"], config.env.NEXT_PUBLIC_BUILD_TIME);
    assert.equal(buildConfig().env.NEXT_PUBLIC_BUILD_ID, "a91d448");
    assert.equal(buildConfig({ BUILD_ID: "prebuilt" }).env.NEXT_PUBLIC_BUILD_ID, "prebuilt");
    assert.equal(buildConfig({}, "", false).env.NEXT_PUBLIC_BUILD_ID, "dev");
    const deployedConfig = spawnSync(process.execPath, ["-e", 'console.log(JSON.stringify(require("./next.config.js").env))'], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH, NODE_ENV: "production", VERCEL_GIT_COMMIT_SHA: buildEnv.NEXT_PUBLIC_BUILD_ID },
    });
    assert.equal(deployedConfig.status, 0, deployedConfig.stderr);
    const actualEnv = JSON.parse(deployedConfig.stdout);
    assert.equal(actualEnv.NEXT_PUBLIC_BUILD_ID, buildEnv.NEXT_PUBLIC_BUILD_ID);
    assert.ok(Number.isFinite(Date.parse(actualEnv.NEXT_PUBLIC_BUILD_TIME)));
  });

  test("client uses static metadata, not the live version endpoint or current clock", () => {
    const source = read(paletteFile);
    assert.match(source, /process\.env\.NEXT_PUBLIC_BUILD_ID/);
    assert.match(source, /process\.env\.NEXT_PUBLIC_BUILD_TIME/);
    assert.doesNotMatch(source, /fetch\(|\/api\/version/);
    const before = renderPalette();
    const previous = process.env.NEXT_PUBLIC_BUILD_ID;
    try {
      process.env.NEXT_PUBLIC_BUILD_ID = "newdeploy";
      assert.equal(renderPalette(), before);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_BUILD_ID;
      else process.env.NEXT_PUBLIC_BUILD_ID = previous;
    }
  });

  test("ticket-specific registry entry inherits Owner+QA and reuses muted micro footer styles", () => {
    const keys = require("./helpers/flag-files.cjs").source();
    const flags = (read("src/lib/flags.ts") + require("./helpers/flag-files.cjs").source());
    assert.match(keys, /HTPR_6892_CMDK_VERSION_FLAG = "htpr-6892-cmdk-version"/);
    assert.match(flags, /key: HTPR_6892_CMDK_VERSION_FLAG,\s*shippedOn: "2026-10-03",\s*description:/);
    assert.match(flags, /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/);
    assert.match(read(paletteFile), /useFlag\(HTPR_6892_CMDK_VERSION_FLAG\)/);
    const dom = new JSDOM(renderPalette());
    try {
      const line = dom.window.document.querySelector("[data-cmdk-version]");
      assert.equal(line.className, "px-4 pb-2 text-micro text-text-light-gray");
      assert.equal(line, line.parentElement.lastElementChild);
      assert.match(line.previousElementSibling.textContent, /navigate.*select.*close/);
    } finally { dom.window.close(); }
  });
}

module.exports = { renderPalette, paletteFile, buildEnv };
