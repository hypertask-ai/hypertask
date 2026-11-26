import { agentIdSchema, userIdSchema } from "@/lib/identity";
import assert from "node:assert";
// @ts-expect-error Node strip-types checks require .ts imports without allowImportingTsExtensions.
import { injectMentionSpans, normalizeMentionSpans } from "./resolveMentions.ts";

const injectNormalizedMentions = (text: string, members: Parameters<typeof normalizeMentionSpans>[1]) =>
  injectMentionSpans(normalizeMentionSpans(text, members), members);

const members = [
  { id: userIdSchema.parse(193), displayName: "Abdul Wahhab" },
  { id: userIdSchema.parse(6), displayName: "Valentin" },
  { id: agentIdSchema.parse("abc123"), displayName: "HT Bot" },
];

assert.ok(
  injectNormalizedMentions("hey @Abdul Wahhab look", members).includes('data-label="name-193"'),
  "@Display Name resolves to name-<id> span",
);

assert.ok(
  injectNormalizedMentions("ping @193 please", members).includes('data-label="name-193"'),
  "@<id> resolves to name-<id> span",
);

const agentOut = injectNormalizedMentions("@HT Bot run it", members);
assert.ok(
  agentOut.includes('data-label="agent-abc123"') && !agentOut.includes("name-"),
  "agent display name resolves to agent-<id> span",
);

assert.strictEqual(
  injectNormalizedMentions("mail me at val@valentin.io", members),
  "mail me at val@valentin.io",
  "email left untouched",
);

const withShort = [...members, { id: userIdSchema.parse(999), displayName: "Abdul" }];
const longest = injectNormalizedMentions("@Abdul Wahhab", withShort);
assert.ok(
  longest.includes("name-193") && !longest.includes("name-999"),
  "longest display name wins over a shorter prefix",
);

assert.ok(
  injectNormalizedMentions("ping @Abdul about it", members).includes('data-label="name-193"'),
  "unique first-name prefix resolves",
);

const ambig = [
  { id: userIdSchema.parse(1), displayName: "Sara Lee" },
  { id: userIdSchema.parse(2), displayName: "Sara Kim" },
];
assert.strictEqual(
  injectNormalizedMentions("hi @Sara", ambig),
  "hi @Sara",
  "ambiguous prefix is left untouched",
);

assert.ok(
  injectNormalizedMentions("hi @Sara Lee", ambig).includes("name-1"),
  "exact full name resolves despite ambiguous shorter prefix",
);

const quoteBreakoutName = 'Bob" onmouseover="alert';
const quoteBreakout = injectNormalizedMentions(`hi @${quoteBreakoutName}`, [
  { id: userIdSchema.parse(7), displayName: quoteBreakoutName },
]);
assert.ok(
  quoteBreakout.includes('Bob&quot; onmouseover=&quot;alert') &&
    !quoteBreakout.includes('onmouseover="'),
  "display names are escaped inside mention span attributes",
);

assert.strictEqual(
  injectNormalizedMentions("just a note about Abdul Wahhab", members),
  "just a note about Abdul Wahhab",
  "name without @ is unchanged",
);

assert.ok(
  normalizeMentionSpans(
    '<span data-type="mention" data-id="Valentin" data-label="valentin-6">Valentin</span>',
    members,
  ).includes('data-label="name-6"'),
  "a guessed person label is rewritten from the display name",
);

const nestedSafe = injectNormalizedMentions(
  normalizeMentionSpans(
    '<span data-type="mention" data-id="Valentin" data-label="valentin-6">@Valentin</span> and @Abdul Wahhab',
    members,
  ),
  members,
);
assert.strictEqual(
  (nestedSafe.match(/<span/g) || []).length,
  2,
  "no span is written inside an existing mention span",
);
assert.ok(
  nestedSafe.includes('data-label="name-193"'),
  "plain text mentions next to an existing span still resolve",
);

console.log("resolveMentions.check.ts: all assertions passed");
