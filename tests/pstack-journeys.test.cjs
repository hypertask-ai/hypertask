const assert = require("node:assert/strict");
const test = require("node:test");
const {
  cacheKey,
  cacheKeyPrefix,
  canonicalScript,
  journeyIds,
  matchingEntry,
  pagesForFiles,
  parseCacheEntry,
  scriptHash,
  sha256,
} = require("../scripts/lib/pstack-journeys.cjs");

const BASE = "1".repeat(40);
const MAP = "2".repeat(40);
const pages = [
  {
    name: "boards-and-views",
    text: "Board drawings live in `src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx`.\n" +
      "Board routes are `src/app/[...boardURL]/page.tsx`.\n" +
      "- `calendar-control-state` With `htpr-7962-calendar-control-state` on, the Filter button is named Filter.\n" +
      "Open `/api/invite/reSendInvite` to resend an invite.\n",
  },
  {
    name: "login",
    text: "Sign in at `/login`. Flags live in `src/lib/flags/definitions/` and never change a page the person sees.\n",
  },
  {
    name: "inbox",
    text: "Notifications land here from `src/pages/api/queues/inboxReminder.ts`.\n",
  },
];

test("a changed flag definition selects the page whose sub-feature or flag key it names", () => {
  const chosen = pagesForFiles({ files: ["src/lib/flags/definitions/htpr-7962-calendar-control-state.ts"], pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views"]);
  assert.equal(chosen[0].score, 4);
});

test("a changed flag definition selects a page that lists only the slug", () => {
  const chosen = pagesForFiles({ files: ["src/lib/flags/definitions/htpr-9000-calendar-control-state.ts"], pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views"]);
});

test("a flag key in the diff selects the page that names it", () => {
  const chosen = pagesForFiles({ files: ["src/utils/controllers/projects/rename.ts"], diff: "+ if (flags.htpr-7962-calendar-control-state)", pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views"]);
});

test("a shared flag directory scores nothing, so an unrelated page is not selected", () => {
  assert.deepEqual(pagesForFiles({ files: ["src/lib/flags/definitions/htpr-9999-unknown-thing.ts"], pages }), []);
});

test("a shared src directory scores nothing", () => {
  assert.deepEqual(pagesForFiles({ files: ["src/utils/controllers/whatever.ts"], pages }), []);
});

test("a named source path and a named API path both select the page", () => {
  assert.deepEqual(pagesForFiles({ files: ["src/app/[...boardURL]/page.tsx"], pages }).map((item) => item.page), ["boards-and-views"]);
  assert.deepEqual(pagesForFiles({ files: ["src/pages/api/queues/inboxReminder.ts"], pages }).map((item) => item.page), ["inbox"]);
  assert.deepEqual(pagesForFiles({ files: ["src/pages/api/invite/reSendInvite.ts"], pages }).map((item) => item.page), ["boards-and-views"]);
});

test("a specific component directory selects its page and scores two", () => {
  const chosen = pagesForFiles({ files: ["src/components/PageComponents/Kanban/KanbanSectionComponents/column.tsx"], pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views"]);
  assert.equal(chosen[0].score, 2);
});

test("a source path named verbatim scores three", () => {
  const chosen = pagesForFiles({ files: ["src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx"], pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views"]);
  assert.equal(chosen[0].score, 3);
});

test("a generic basename never selects a page", () => {
  const generic = [{ name: "themes", text: "Every page.tsx and route.ts draws this." }];
  assert.deepEqual(pagesForFiles({ files: ["src/app/settings/page.tsx"], pages: generic }), []);
  assert.deepEqual(pagesForFiles({ files: ["package.json", "README.md", "tsconfig.json"], pages: generic }), []);
});

test("a feature-named component file selects its page by name", () => {
  const named = [{ name: "calendar", text: "The card is `calendar-control-state.tsx`." }];
  assert.deepEqual(pagesForFiles({ files: ["src/components/calendar-control-state.tsx"], pages: named }).map((item) => item.page), ["calendar"]);
});

test("pages carry a score and are ordered by it, then by name", () => {
  const chosen = pagesForFiles({ files: ["src/lib/flags/definitions/htpr-7962-calendar-control-state.ts", "src/pages/api/queues/inboxReminder.ts"], pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views", "inbox"]);
});

test("an app change that matches no page returns nothing, so the run falls back", () => {
  assert.deepEqual(pagesForFiles({ files: ["src/lib/api/task-writes/create-global.ts"], diff: "htpr-9399-archived-board-tickets", pages }), []);
});

test("journeys pair one area id per matched page with one change id", () => {
  assert.deepEqual(journeyIds({ pages: ["boards-and-views", "inbox"] }), ["area:boards-and-views", "area:inbox", "change:primary"]);
  assert.deepEqual(journeyIds({ pages: [], bugfix: true }), ["change:repro"]);
});

test("the script hash ignores key order and changes with the script", () => {
  assert.equal(canonicalScript([{ op: "goto", path: "/" }], []), canonicalScript([{ op: "goto", path: "/" }], []));
  assert.equal(scriptHash([{ op: "goto", path: "/" }], []), scriptHash([{ op: "goto", path: "/" }], []));
  assert.notEqual(scriptHash([{ op: "goto", path: "/" }], []), scriptHash([{ op: "goto", path: "/inbox" }], []));
  assert.match(scriptHash([], []), /^[0-9a-f]{64}$/);
});

test("cache keys carry the base sha and the map sha", () => {
  assert.equal(cacheKeyPrefix(BASE), `pstack-base-${BASE}-`);
  assert.equal(cacheKey(BASE, MAP), `pstack-base-${BASE}-${MAP}`);
  assert.throws(() => cacheKeyPrefix("production"), /not a sha/);
  assert.throws(() => cacheKey(BASE, "main"), /not a sha/);
});

const entry = () => ({
  baseSha: BASE,
  mapSha: MAP,
  journey: "area:boards-and-views",
  scriptHash: sha256("script"),
  pageHash: sha256("page"),
  ok: true,
  judged: { verdict: "PASS" },
  steps: [{ action: { op: "goto", path: "/" }, ok: true }],
  expects: [{ expect: { text: "Inbox" }, ok: true }],
  navigations: [{ url: "http://127.0.0.1:3000/", status: 200 }],
  offOrigin: [],
});

test("a valid cache entry parses and keeps its verdict", () => {
  const parsed = parseCacheEntry(JSON.stringify(entry()));
  assert.equal(parsed.baseSha, BASE);
  assert.equal(parsed.journey, "area:boards-and-views");
  assert.deepEqual(parsed.judged, { verdict: "PASS" });
  assert.equal(parsed.pageHash, sha256("page"));
});

test("a cache entry without its page hash is ignored", () => {
  const { pageHash, ...rest } = entry();
  assert.equal(parseCacheEntry(rest), null);
  assert.equal(parseCacheEntry({ ...rest, pageHash: "short" }), null);
});

test("a malformed cache entry is ignored, never trusted", () => {
  assert.equal(parseCacheEntry("not json"), null);
  assert.equal(parseCacheEntry({ ...entry(), baseSha: "main" }), null);
  assert.equal(parseCacheEntry({ ...entry(), mapSha: "x" }), null);
  assert.equal(parseCacheEntry({ ...entry(), scriptHash: "short" }), null);
  assert.equal(parseCacheEntry({ ...entry(), steps: [{ ok: "yes" }] }), null);
  assert.equal(parseCacheEntry({ ...entry(), steps: new Array(13).fill({ ok: true }) }), null);
  assert.equal(parseCacheEntry({ ...entry(), offOrigin: [{ url: "https://example.com", kind: "navigation" }] }), null);
});

test("a cached result is reused only for the same base, map, journey and script", () => {
  const wanted = { baseSha: BASE, mapSha: MAP, journey: "area:boards-and-views", scriptHash: sha256("script") };
  assert.ok(matchingEntry([entry()], wanted));
  assert.equal(matchingEntry([entry()], { ...wanted, baseSha: "3".repeat(40) }), null);
  assert.equal(matchingEntry([entry()], { ...wanted, mapSha: "4".repeat(40) }), null);
  assert.equal(matchingEntry([entry()], { ...wanted, journey: "change:primary" }), null);
  assert.equal(matchingEntry([entry()], { ...wanted, scriptHash: sha256("other") }), null);
});
