import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXES_ENTRY_TITLE,
  MORE_ENTRY_TITLE,
  buildDigestEntries,
  entrySummary,
  entryTitle,
  plainText,
  type ShippedTicket,
} from "../src/lib/rocketDigest/entries";
import {
  RELEASE_SECTION_TITLES,
  isInternalLabel,
  ticketKind,
  toShippedTickets,
  type ReleaseEventRow,
} from "../src/lib/rocketDigest/selection";
import { digestUntil } from "../src/lib/rocketDigest/cursor";

const day = (iso: string) => new Date(`${iso}T07:23:00.000Z`);

function ticket(overrides: Partial<ShippedTicket> = {}): ShippedTicket {
  return {
    uniqueIndex: 9001,
    title: "Sticky note colours",
    description:
      "<p><strong>What&#x27;s wrong or wanted:</strong> Note colours reset after a reload. <strong>Who it affects:</strong> everyone.</p>",
    releasedAt: day("2026-11-02"),
    kind: "feature",
    ...overrides,
  };
}

type TaskRow = Partial<ReleaseEventRow["task"]>;

function row({ timestamp, task }: { timestamp?: Date; task?: TaskRow } = {}): ReleaseEventRow {
  return {
    timestamp: timestamp ?? day("2026-11-02"),
    task: {
      uniqueIndex: 9001,
      title: "Sticky note colours",
      description: "<p>Shipped.</p>",
      section: "Flag: Everyone",
      deletedAt: null,
      taskLabels: [{ label: { value: "FEATURE 💎" } }],
      ...task,
    },
  };
}

test("plainText drops markup and decodes the handful of entities we post", () => {
  assert.equal(
    plainText("<p>Note colours <strong>reset</strong> &amp; revert&nbsp;now</p><ul><li>One</li></ul>"),
    "Note colours reset & revert now One",
  );
});

test("entryTitle drops ticket and type prefixes", () => {
  assert.equal(entryTitle("HTPR-8948 [BUGFIX] Panel went quiet"), "Panel went quiet");
  assert.equal(entryTitle("[FEATURE] Board picker"), "Board picker");
});

test("entrySummary keeps the first field and stops before the next one", () => {
  assert.equal(
    entrySummary(
      "<p><strong>What&#x27;s wrong or wanted:</strong> Panel stopped updating 3 weeks ago.</p><p><strong>Who it affects:</strong> every user.</p>",
    ),
    "Panel stopped updating 3 weeks ago.",
  );
  assert.equal(
    entrySummary("<p>Boards open faster now. Vitals read from cache.</p>"),
    "Boards open faster now.",
  );
});

test("buildDigestEntries makes one entry per topic and groups fixes", () => {
  const entries = buildDigestEntries([
    ticket({ uniqueIndex: 1, title: "Board picker", releasedAt: day("2026-10-20") }),
    ticket({ uniqueIndex: 2, title: "Wide cards scroll", kind: "fix", releasedAt: day("2026-10-21") }),
    ticket({ uniqueIndex: 3, title: "Search operators", kind: "improvement", releasedAt: day("2026-10-19") }),
    ticket({ uniqueIndex: 4, title: "Undo archive", kind: "fix", releasedAt: day("2026-10-22") }),
  ]);

  assert.deepEqual(
    entries.map((entry) => entry.title),
    ["Search operators", "Board picker", FIXES_ENTRY_TITLE],
  );
  assert.deepEqual(entries[2].ticketIds, [2, 4]);
  assert.equal(entries[2].releasedAt.toISOString(), day("2026-10-22").toISOString());
  assert.match(entries[2].content, /Wide cards scroll/);
  assert.match(entries[2].content, /Undo archive/);
});

test("buildDigestEntries folds overflowing topics into one entry", () => {
  const tickets = Array.from({ length: 13 }, (_, index) =>
    ticket({
      uniqueIndex: index + 1,
      title: `Change ${index + 1}`,
      releasedAt: new Date(day("2026-10-01").getTime() + index * 3_600_000),
    }),
  );
  const entries = buildDigestEntries(tickets, { maxTopics: 10 });
  assert.equal(entries.length, 11);
  assert.equal(entries[0].title, MORE_ENTRY_TITLE);
  assert.deepEqual(entries[0].ticketIds, [1, 2, 3]);
  assert.equal(entries.at(-1)?.title, "Change 13");
});

test("toShippedTickets keeps released work and drops internal or reverted tickets", () => {
  const rows = [
    row(),
    row({ task: { uniqueIndex: 9002, taskLabels: [{ label: { value: "CI" } }] } }),
    row({ task: { uniqueIndex: 9003, taskLabels: [{ label: { value: "agent-fleet" } }] } }),
    row({ task: { uniqueIndex: 9004, section: "Flag: Off" } }),
    row({ task: { uniqueIndex: 9005, deletedAt: new Date() } }),
    row({ timestamp: day("2026-11-05"), task: { uniqueIndex: 9006, taskLabels: [{ label: { value: "Bug" } }] } }),
  ];

  assert.deepEqual(
    toShippedTickets(rows).map((entry) => [entry.uniqueIndex, entry.kind]),
    [
      [9001, "feature"],
      [9006, "fix"],
    ],
  );
});

test("toShippedTickets keeps the first release event and honours an override", () => {
  const tickets = toShippedTickets([
    row({ timestamp: day("2026-10-30") }),
    row({ timestamp: day("2026-11-04") }),
  ]);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].releasedAt.toISOString(), day("2026-10-30").toISOString());
  assert.deepEqual(RELEASE_SECTION_TITLES, ["Flag: Everyone", "No Flag"]);
  assert.equal(toShippedTickets([row({ task: { section: "Done" } })], ["Done"]).length, 1);
});

test("labels decide what is internal and what kind of change it is", () => {
  assert.equal(isInternalLabel("CI"), true);
  assert.equal(isInternalLabel("agent-fleet"), true);
  assert.equal(isInternalLabel("Cursor runners 6 Nov"), true);
  assert.equal(isInternalLabel("FEATURE 💎"), false);
  assert.equal(ticketKind(["Bug", "brain-medium"]), "fix");
  assert.equal(ticketKind(["FEATURE 💎"]), "feature");
  assert.equal(ticketKind(["Quick wins"]), "improvement");
});

test("digestUntil reads the cursor marker and ignores junk", () => {
  assert.equal(
    digestUntil({ digest: { until: "2026-10-22T07:00:00.000Z" } })?.toISOString(),
    "2026-10-22T07:00:00.000Z",
  );
  assert.equal(digestUntil({ title: "No marker" }), null);
  assert.equal(digestUntil({ digest: { until: "not-a-date" } }), null);
  assert.equal(digestUntil(null), null);
});

