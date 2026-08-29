const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(path.join(root, `tests/calendar-jiti-entry-${++jitiEntryId}.cjs`), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return jiti(path.join(root, relativePath));
}

test("escapeText escapes RFC 5545 special characters", () => {
  const { escapeText } = loadTs("src/lib/calendar/ics.ts");
  assert.equal(escapeText("a;b,c\\d"), "a\\;b\\,c\\\\d");
  assert.equal(escapeText("line1\nline2"), "line1\\nline2");
  // Backslash must be escaped first so it doesn't double-escape the others.
  assert.equal(escapeText("\\;"), "\\\\\\;");
});

test("foldLine wraps lines over 75 octets without splitting codepoints", () => {
  const { foldLine } = loadTs("src/lib/calendar/ics.ts");

  const short = "SUMMARY:hi";
  assert.equal(foldLine(short), short, "short lines are untouched");

  const long = "SUMMARY:" + "x".repeat(100);
  const folded = foldLine(long);
  const parts = folded.split("\r\n");
  assert.ok(parts.length > 1, "long line is folded");
  assert.ok(
    Buffer.byteLength(parts[0], "utf8") <= 75,
    "first segment is <= 75 octets"
  );
  parts.slice(1).forEach((p) => {
    assert.ok(p.startsWith(" "), "continuation lines start with a space");
  });
  // Unfolding (drop CRLF+space) restores the original.
  assert.equal(folded.replace(/\r\n /g, ""), long);

  // A 4-byte emoji straddling the 75-octet boundary must not be cut in half.
  const emojiLine = "X".repeat(73) + "😀😀😀";
  const foldedEmoji = foldLine(emojiLine);
  assert.equal(foldedEmoji.replace(/\r\n /g, ""), emojiLine);
});

test("isMidnightUtc distinguishes all-day from timed", () => {
  const { isMidnightUtc } = loadTs("src/lib/calendar/ics.ts");
  assert.equal(isMidnightUtc(new Date("2026-07-16T00:00:00.000Z")), true);
  assert.equal(isMidnightUtc(new Date("2026-07-16T14:30:00.000Z")), false);
});

test("buildEvent emits all-day event for midnight due date", () => {
  const { buildEvent } = loadTs("src/lib/calendar/ics.ts");
  const lines = buildEvent(
    {
      id: 42,
      uniqueIndex: 7,
      ticketNumber: "HTPR-7",
      title: "Ship, now",
      section: "In Progress",
      projectId: 15,
      dueDate: new Date("2026-07-16T00:00:00.000Z"),
    },
    new Date("2026-07-14T09:00:00.000Z")
  );

  assert.ok(lines.includes("DTSTART;VALUE=DATE:20260716"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20260717"), "all-day end is next day");
  assert.ok(lines.includes("UID:task-42@hypertask.ai"));
  // Comma in the title is escaped in SUMMARY.
  assert.ok(lines.includes("SUMMARY:HTPR-7 Ship\\, now"));
  assert.ok(lines.includes("URL:https://app.hypertask.ai/detail/project-15/7"));
});

test("buildEvent emits timed event with +1h end for non-midnight due date", () => {
  const { buildEvent } = loadTs("src/lib/calendar/ics.ts");
  const lines = buildEvent(
    {
      id: 1,
      uniqueIndex: 1,
      ticketNumber: null,
      title: "Call",
      section: "Todo",
      projectId: 15,
      dueDate: new Date("2026-07-16T14:30:00.000Z"),
    },
    new Date("2026-07-14T09:00:00.000Z")
  );
  assert.ok(lines.includes("DTSTART:20260716T143000Z"));
  assert.ok(lines.includes("DTEND:20260716T153000Z"), "timed end is +1 hour");
  // No ticketNumber -> summary is just the title.
  assert.ok(lines.includes("SUMMARY:Call"));
});

test("buildCalendar wraps events and terminates lines with CRLF", () => {
  const { buildCalendar } = loadTs("src/lib/calendar/ics.ts");
  const ics = buildCalendar(
    [
      {
        id: 1,
        uniqueIndex: 1,
        ticketNumber: "HTPR-1",
        title: "One",
        section: "Todo",
        projectId: 15,
        dueDate: new Date("2026-07-16T00:00:00.000Z"),
      },
    ],
    new Date("2026-07-14T09:00:00.000Z")
  );
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.includes("PRODID:-//Hypertask//Calendar Feed//EN"));
  assert.ok(ics.trimEnd().endsWith("END:VCALENDAR"));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});
