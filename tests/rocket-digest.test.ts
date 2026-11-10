import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXES_ENTRY_TITLE,
  MAX_TOPIC_ENTRIES,
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

test("buildDigestEntries caps topic entries and defers the rest to the next run", () => {
  const tickets = Array.from({ length: 13 }, (_, index) =>
    ticket({
      uniqueIndex: index + 1,
      title: `Change ${index + 1}`,
      description: `<p>Change ${index + 1} makes the board easier to read.</p>`,
      releasedAt: new Date(day("2026-10-01").getTime() + index * 3_600_000),
    }),
  );

  const first = buildDigestEntries(tickets, { maxTopics: 10 });
  assert.equal(first.length, 10);
  assert.equal(first.at(-1)?.title, "Change 10");
  assert.equal(MAX_TOPIC_ENTRIES, 12);
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

test("entrySummary drops the internal flag link and the ticket template fields", () => {
  assert.equal(
    entrySummary(
      "<p>Flag: <a href=\"https://app.hypertask.ai/admin/flags/htpr-8928\">https://app.hypertask.ai/admin/flags/htpr-8928</a> (Everyone)</p><p><strong>What&#x27;s wrong or wanted:</strong> Ctrl+E on a whole-column selection should empty the column instantly.</p>",
    ),
    "Ctrl+E on a whole-column selection should empty the column instantly.",
  );
  assert.equal(
    entrySummary("<p>Flag: Everyone</p><p>Problem: creating a task from AI chat takes too long.</p>"),
    "Creating a task from AI chat takes too long.",
  );
  assert.equal(entrySummary("<p>Why.</p>"), "");
});

test("entrySummary skips pointer-only and placeholder sentences", () => {
  assert.equal(entrySummary("<p>Follow-up to HTPR-7758.</p>"), "");
  assert.equal(entrySummary("<p>Now Ready to build.</p>"), "");
  assert.equal(entrySummary("<p>See HTPR-1.</p>"), "");
  assert.equal(
    entrySummary("<p>Follow-up to HTPR-7758.</p><p>The chat window opens the ticket it just created.</p>"),
    "The chat window opens the ticket it just created.",
  );
});

test("buildDigestEntries skips tickets without a usable description", () => {
  const entries = buildDigestEntries([
    ticket({ uniqueIndex: 1, title: "Chat creates tickets", description: "<p>Why.</p>" }),
    ticket({ uniqueIndex: 2, title: "Board picker", description: "<p>Pick a board from the header.</p>" }),
  ]);

  assert.deepEqual(
    entries.map((entry) => entry.title),
    ["Board picker"],
  );
});

test("buildDigestEntries groups fixes without a bulk count and caps the list", () => {
  const fixes = Array.from({ length: 1062 }, (_, index) =>
    ticket({
      uniqueIndex: 5000 + index,
      title: `Small fix ${index + 1}`,
      description: "<p>Fixed.</p>",
      kind: "fix",
      releasedAt: new Date(day("2026-11-01").getTime() + index * 60_000),
    }),
  );
  const entries = buildDigestEntries(fixes);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, FIXES_ENTRY_TITLE);
  assert.doesNotMatch(entries[0].content, /more/);
  assert.equal(entries[0].content.split("; ").length, 4);
});

test("toShippedTickets keeps released work and drops internal or reverted tickets", () => {
  const rows = [
    row(),
    row({ task: { uniqueIndex: 9002, taskLabels: [{ label: { value: "CI" } }] } }),
    row({ task: { uniqueIndex: 9003, taskLabels: [{ label: { value: "agent-fleet" } }] } }),
    row({ task: { uniqueIndex: 9007, taskLabels: [{ label: { value: "ai-feedback" } }] } }),
    row({ task: { uniqueIndex: 9008, title: "Agent feedback, friction: CLI call failed" } }),
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

test("toShippedTickets keeps the first release event and drops reverted work", () => {
  const tickets = toShippedTickets([
    row({ timestamp: day("2026-10-30") }),
    row({ timestamp: day("2026-11-04") }),
  ]);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].releasedAt.toISOString(), day("2026-10-30").toISOString());
  assert.deepEqual(RELEASE_SECTION_TITLES, ["Flag: Everyone", "No Flag"]);
  assert.equal(toShippedTickets([row({ task: { section: "Done" } })]).length, 1);
  assert.equal(toShippedTickets([row({ task: { section: "Flag: Off" } })]).length, 0);
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

