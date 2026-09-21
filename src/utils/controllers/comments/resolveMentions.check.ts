// Runnable check for HTPR-3783 server-side @mention resolution.
// Run: node --experimental-strip-types src/utils/controllers/comments/resolveMentions.check.ts
import assert from "node:assert";
// @ts-ignore -- explicit .ts extension is required by `node --experimental-strip-types`
import { injectMentionSpans } from "./resolveMentions.ts";

const members = [
  { id: 193, displayName: "Abdul Wahhab" },
  { id: 6, displayName: "Valentin" },
  { id: "abc123", displayName: "HT Bot" }, // board agent (string id)
];

// @Display Name -> human mention span with name-<id> (the whole point).
assert.ok(
  injectMentionSpans("hey @Abdul Wahhab look", members).includes('data-label="name-193"'),
  "@Display Name resolves to name-<id> span",
);

// @<id> -> same span, for callers that prefer ids.
assert.ok(
  injectMentionSpans("ping @193 please", members).includes('data-label="name-193"'),
  "@<id> resolves to name-<id> span",
);

// Board agent display name -> agent-<id> span (different label, must not be name-).
const agentOut = injectMentionSpans("@HT Bot run it", members);
assert.ok(
  agentOut.includes('data-label="agent-abc123"') && !agentOut.includes("name-"),
  "agent display name resolves to agent-<id> span",
);

// Email address must NOT be turned into a mention (lookbehind guards the @).
assert.strictEqual(
  injectMentionSpans("mail me at val@valentin.io", members),
  "mail me at val@valentin.io",
  "email left untouched",
);

// Longest match wins: "@Abdul Wahhab" must not be partially eaten by a shorter "Abdul".
const withShort = [...members, { id: 999, displayName: "Abdul" }];
const longest = injectMentionSpans("@Abdul Wahhab", withShort);
assert.ok(
  longest.includes("name-193") && !longest.includes("name-999"),
  "longest display name wins over a shorter prefix",
);

// Unique first-name prefix: "@Abdul" resolves to the only member starting with it.
assert.ok(
  injectMentionSpans("ping @Abdul about it", members).includes('data-label="name-193"'),
  "unique first-name prefix resolves",
);

// Ambiguous prefix: two members start with "Sara" -> left as plain text, no guess.
const ambig = [
  { id: 1, displayName: "Sara Lee" },
  { id: 2, displayName: "Sara Kim" },
];
assert.strictEqual(
  injectMentionSpans("hi @Sara", ambig),
  "hi @Sara",
  "ambiguous prefix is left untouched",
);

// Exact full name still wins even when a prefix would be ambiguous.
assert.ok(
  injectMentionSpans("hi @Sara Lee", ambig).includes("name-1"),
  "exact full name resolves despite ambiguous shorter prefix",
);

const quoteBreakoutName = 'Bob" onmouseover="alert';
const quoteBreakout = injectMentionSpans(`hi @${quoteBreakoutName}`, [
  { id: 7, displayName: quoteBreakoutName },
]);
assert.ok(
  quoteBreakout.includes('Bob&quot; onmouseover=&quot;alert') &&
    !quoteBreakout.includes('onmouseover="'),
  "display names are escaped inside mention span attributes",
);

// A plain name with no "@" is left completely alone (no accidental notifications).
assert.strictEqual(
  injectMentionSpans("just a note about Abdul Wahhab", members),
  "just a note about Abdul Wahhab",
  "name without @ is unchanged",
);

console.log("resolveMentions.check.ts: all assertions passed");
