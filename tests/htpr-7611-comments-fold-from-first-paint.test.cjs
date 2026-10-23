const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const globalStatesFile = "src/hooks/Task Detail/useTaskDetailGlobalStates.ts";
const commentsHookFile = "src/hooks/Task Detail/CommentAndDescriptionHooks/useCommentAndDescriptions.ts";

function load(file, mocks = {}) {
  const exports = {};
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function("require", "exports", js)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

const { commentsStackedSetting } = load("src/lib/taskDetailCommentsStacked.ts");
const { processComments } = load("src/utils/helperFunctions/TaskDetail/index.ts", {
  "@/models/model": {},
  "@/utils/htmlEscape": { escapeHtml: (value) => value },
  "@/lib/richText/replyQuote": { REPLY_QUOTE_DATA_ATTRIBUTE: "data-reply-quote" },
});

const userId = 985;
const thread = [1, 2, 3, 4, 5, 6].map((id) => ({ id, seen: [userId] }));
const defaultPreferences = { loaded: false, stacked: false };

function foldedMap({ flagOn, serverStacked, preferences = defaultPreferences, hash = "", newCommentIds = [] }) {
  const stacked = commentsStackedSetting({
    foldFromFirstPaint: flagOn,
    preferencesLoaded: preferences.loaded,
    serverStacked,
    preferenceStacked: preferences.stacked,
  });
  return processComments(thread, userId, stacked, hash, newCommentIds);
}

const serverMap = processComments(thread, userId, true, "");

test("now refused: with the flag on, folded comments stay folded before the saved settings arrive", () => {
  assert.deepEqual(foldedMap({ flagOn: true, serverStacked: true }), serverMap);
  assert.deepEqual(Object.values(serverMap), [true, true, true, true, true, false]);
});

test("flag off keeps today's behaviour: the settings default unfolds every comment until the settings arrive", () => {
  assert.deepEqual(Object.values(foldedMap({ flagOn: false, serverStacked: true })), [false, false, false, false, false, false]);
});

test("still allowed: the saved setting arriving with the same value changes nothing, so the thread does not move", () => {
  const before = foldedMap({ flagOn: true, serverStacked: true });
  const after = foldedMap({ flagOn: true, serverStacked: true, preferences: { loaded: true, stacked: true } });
  assert.deepEqual(after, before);
});

test("still allowed: switching folding off in settings unfolds the thread once the settings are loaded", () => {
  assert.deepEqual(Object.values(foldedMap({ flagOn: true, serverStacked: true, preferences: { loaded: true, stacked: false } })), [false, false, false, false, false, false]);
});

test("still allowed: a page with no server setting keeps reading the user's preference", () => {
  assert.equal(commentsStackedSetting({ foldFromFirstPaint: true, preferencesLoaded: false, serverStacked: undefined, preferenceStacked: true }), true);
  assert.equal(commentsStackedSetting({ foldFromFirstPaint: true, preferencesLoaded: false, serverStacked: undefined, preferenceStacked: false }), false);
});

test("still allowed: new comments and a #comment link still open on first paint", () => {
  assert.equal(foldedMap({ flagOn: true, serverStacked: true, newCommentIds: [2] })[1], false);
  assert.equal(foldedMap({ flagOn: true, serverStacked: true, hash: "#comment-2" })[2], false);
});

test("the ticket hook reads the folded setting through the helper", () => {
  const source = read(globalStatesFile);
  assert.match(source, /const foldFromFirstPaint = foldFlagOn \|\| !foldFlagLoaded;/);
  assert.match(source, /serverStacked: stack\?\.stack,/);
  assert.match(source, /preferencesLoaded: userPreferencesLoadedAt > 0,/);
  assert.match(source, /stackData: commentsStacked,/);
});

test("the first seen pass uses the same setting without adding a dependency that would repeat the seen request", () => {
  const source = read(commentsHookFile);
  assert.match(source, /commentsStackedRef\.current = foldFromFirstPaint \? stackData : undefined;/);
  assert.match(source, /commentsStackedRef\.current \?\? stack_\?\.stack,/);
  const updateSeen = source.slice(source.indexOf("const updateSeen = useCallback"), source.indexOf("const updateStackFromSidebar"));
  const deps = updateSeen.slice(updateSeen.lastIndexOf("}, ["));
  assert.doesNotMatch(deps, /stackData|commentsStacked/);
});

test("ticket pages have no flag snapshot, so both hooks treat the fix as on until flags load and as Off only once loaded", () => {
  for (const file of [globalStatesFile, commentsHookFile]) {
    const source = read(file);
    assert.match(source, /import \{ useFlag, useFlagLoaded \} from "@\/hooks\/useFlag";/, file);
    assert.match(source, /const foldFlagOn = useFlag\(HTPR_7611_COMMENTS_FOLD_FROM_FIRST_PAINT_FLAG\);\n  const foldFlagLoaded = useFlagLoaded\(HTPR_7611_COMMENTS_FOLD_FROM_FIRST_PAINT_FLAG\);\n  const foldFromFirstPaint = foldFlagOn \|\| !foldFlagLoaded;/, file);
  }
});

test("flag ships as a bugfix on Everyone", () => {
  const definition = read("src/lib/flags/definitions/htpr-7611-comments-fold-from-first-paint.ts");
  assert.match(definition, /kind: "bugfix"/);
  assert.match(definition, /defaultMode: "EVERYONE"/);
});
