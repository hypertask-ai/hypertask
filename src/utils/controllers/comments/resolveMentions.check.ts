import assert from "node:assert";
// @ts-expect-error Node strip-types checks require .ts imports without allowImportingTsExtensions.
import { injectMentionSpans } from "./resolveMentions.ts";

const members = [
  { id: 193, displayName: "Abdul Wahhab" },
  { id: 6, displayName: "Valentin" },
  { id: "abc123", displayName: "HT Bot" },
];

assert.ok(
  injectMentionSpans("hey @Abdul Wahhab look", members).includes('data-label="name-193"'),
  "@Display Name resolves to name-<id> span",
);

assert.ok(
  injectMentionSpans("ping @193 please", members).includes('data-label="name-193"'),
  "@<id> resolves to name-<id> span",
);

const agentOut = injectMentionSpans("@HT Bot run it", members);
assert.ok(
  agentOut.includes('data-label="agent-abc123"') && !agentOut.includes("name-"),
  "agent display name resolves to agent-<id> span",
);

assert.strictEqual(
  injectMentionSpans("mail me at val@valentin.io", members),
  "mail me at val@valentin.io",
  "email left untouched",
);

const withShort = [...members, { id: 999, displayName: "Abdul" }];
const longest = injectMentionSpans("@Abdul Wahhab", withShort);
assert.ok(
  longest.includes("name-193") && !longest.includes("name-999"),
  "longest display name wins over a shorter prefix",
);

assert.ok(
  injectMentionSpans("ping @Abdul about it", members).includes('data-label="name-193"'),
  "unique first-name prefix resolves",
);

const ambig = [
  { id: 1, displayName: "Sara Lee" },
  { id: 2, displayName: "Sara Kim" },
];
assert.strictEqual(
  injectMentionSpans("hi @Sara", ambig),
  "hi @Sara",
  "ambiguous prefix is left untouched",
);

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

assert.strictEqual(
  injectMentionSpans("just a note about Abdul Wahhab", members),
  "just a note about Abdul Wahhab",
  "name without @ is unchanged",
);

console.log("resolveMentions.check.ts: all assertions passed");
