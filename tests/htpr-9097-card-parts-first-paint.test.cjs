const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule, root } = require("./helpers/loadModule.cjs");

const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const { CARD_PARTS, DEFAULT_CARD_PARTS, EMPTY_CARD_PARTS, parseCardParts, readCardParts, resolveCardParts, settleCardParts, shownCardParts } =
  loadModule("src/lib/kanban/cardParts.ts");
const { hasFirstScreenDisplayPreferences } = loadModule("src/lib/firstScreen/contract.ts");

const allOff = Object.fromEntries(CARD_PARTS.map(({ key }) => [key, false]));
const allOn = Object.fromEntries(CARD_PARTS.map(({ key }) => [key, true]));
const allKeys = CARD_PARTS.map(({ key }) => key);
const everyPart = (parts) => CARD_PARTS.every(({ key }) => parts[key] === false);

test("a saved record with every part off reads as every part off", () => {
  assert.ok(everyPart(readCardParts(allOff)));
  assert.ok(everyPart(resolveCardParts(allOff, undefined)));
});

test("the display cookie keeps only the parts that are on, compact enough for its size limit", () => {
  assert.deepEqual(shownCardParts(parseCardParts(allOff)), []);
  assert.deepEqual(shownCardParts(parseCardParts(allOn)), allKeys);
  assert.deepEqual(shownCardParts(parseCardParts({ tags: true, people: false })), ["tags"]);
  assert.deepEqual(readCardParts([]), parseCardParts(allOff));
  assert.deepEqual(readCardParts(["tags"]), parseCardParts({ tags: true, people: false }));
});

test("no saved record yet is unknown, not the default parts", () => {
  assert.equal(readCardParts(undefined), undefined);
  assert.equal(readCardParts(null), undefined);
  assert.equal(readCardParts("tags"), undefined);
  assert.equal(resolveCardParts(undefined, undefined), null);
  assert.equal(DEFAULT_CARD_PARTS.people, true);
  assert.equal(DEFAULT_CARD_PARTS.priority, false);
});

test("a person who never saved card settings keeps the default parts once preferences load", () => {
  assert.deepEqual(settleCardParts(null, undefined, false), null);
  assert.deepEqual(settleCardParts(null, undefined, true), DEFAULT_CARD_PARTS);
  assert.deepEqual(settleCardParts(undefined, undefined, true), DEFAULT_CARD_PARTS);
});

test("the display cookie's card parts answer the first paint while the preferences query is still the default", () => {
  const firstPaint = resolveCardParts(undefined, []);
  assert.ok(everyPart(firstPaint));
  assert.deepEqual(firstPaint, readCardParts(allOff));
});

test("a live preferences change wins over the boot card parts", () => {
  assert.deepEqual(resolveCardParts(allOn, []), parseCardParts(allOn));
  assert.ok(CARD_PARTS.every(({ key }) => resolveCardParts(allOn, [])[key] === true));
});

test("a card with unknown parts draws no detail and never the default parts", () => {
  const card = read("src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard.tsx");
  assert.match(card, /const savedParts = useCardParts\(\);/);
  assert.match(card, /const parts = savedParts \?\? EMPTY_CARD_PARTS;/);
  assert.match(card, /cardSettings \? parts : ALL_CARD_PARTS/);
  assert.doesNotMatch(card, /\?\? DEFAULT_CARD_PARTS/);
  assert.ok(everyPart(EMPTY_CARD_PARTS));
});

test("the hook asks the first screen surface before it settles on anything", () => {
  const hook = read("src/hooks/General/useCardParts.ts");
  assert.match(hook, /const surface = useFirstScreenSurface\(\);/);
  assert.match(hook, /const boot = surface\?\.display\.cardParts;/);
  assert.match(hook, /settleCardParts\(saved, boot, isFetched\)/);
});

test("switching a part before preferences load keeps the parts the board is already showing", () => {
  const hook = read("src/hooks/General/useCardParts.ts");
  const settings = read("src/components/Modals/Settings/CardSettingsSection.tsx");
  assert.match(hook, /const useSetCardPart = \(shown: CardParts\) => \{/);
  assert.match(hook, /const next: CardParts = \{ \.\.\.shown, \[part\]: value \};/);
  assert.match(settings, /const setPart = useSetCardPart\(parts\);/);
});

test("the display cookie written from the board carries the person's card parts, so the next reload draws them at once", () => {
  const mirror = read("src/lib/firstScreen/BoardDisplayMirror.tsx");
  assert.match(mirror, /const cardParts = useCardParts\(\);/);
  assert.match(mirror, /\[cardParts \? \{ \.\.\.display, cardParts: shownCardParts\(cardParts\) \} : display, display\]/);
  assert.match(mirror, /chatSidebarMode, cardParts\]\);/);
});

test("a display cookie that would overflow the size limit still writes without the card parts", () => {
  const mirror = read("src/lib/firstScreen/BoardDisplayMirror.tsx");
  assert.match(mirror, /encoded\.length <= 3800 && parseBoardDisplay\(JSON\.stringify\(candidate\), accountId, \{ desktopChat \}\)/);
  assert.match(mirror, /stored\?\.encoded \?\? ""/);
});

test("a first screen display accepts real card parts and rejects junk", () => {
  const display = (cardParts) => ({
    version: 1,
    accountId: 7,
    timeZone: "Europe/London",
    locale: "en-GB",
    boardLayout: "board",
    theme: "porcelain",
    railCollapsed: false,
    quickTips: true,
    draftsFirst: false,
    ...(cardParts === undefined ? {} : { cardParts }),
  });
  assert.equal(hasFirstScreenDisplayPreferences(display(undefined), 7), true);
  assert.equal(hasFirstScreenDisplayPreferences(display(shownCardParts(parseCardParts(allOn))), 7), true);
  assert.equal(hasFirstScreenDisplayPreferences(display(["tags"]), 7), true);
  assert.equal(hasFirstScreenDisplayPreferences(display([false]), 7), false);
  assert.equal(hasFirstScreenDisplayPreferences(display({ tags: "off" }), 7), false);
});
