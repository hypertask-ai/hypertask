// Runnable check for HTPR-3953 ticket-ref linkification (pure text-transform part).
// Run: node --experimental-strip-types src/utils/controllers/comments/ticketRefLinker.check.ts
import assert from "node:assert";
// @ts-ignore -- explicit .ts extension is required by `node --experimental-strip-types`
import { findLinkableTicketRefs, applyTicketRefLinks, buildUnambiguousRefMap, markAiDetailAnchors } from "./ticketRefLinker.ts";

// Ref in plain text is picked up for resolution.
assert.deepStrictEqual(
  findLinkableTicketRefs("<p>See HTPR-1234 for details.</p>"),
  ["HTPR-1234"],
  "plain-text ref found"
);

// Ref already inside an anchor is not a candidate for re-linking.
assert.deepStrictEqual(
  findLinkableTicketRefs(
    '<p>See <a href="/detail/project-4/70">HTPR-1234</a> for details.</p>'
  ),
  [],
  "ref inside existing <a> is skipped"
);

// Resolved ref gets wrapped (with the data-ai-linkified marker); unresolved ref
// is left as plain text.
assert.strictEqual(
  applyTicketRefLinks(
    "<p>See HTPR-1234 and INNE-999 for details.</p>",
    new Map([["HTPR-1234", 15]])
  ),
  '<p>See <a href="/detail/project-15/1234" data-ai-linkified="1">HTPR-1234</a> and INNE-999 for details.</p>',
  "resolved ref wrapped with ai-linkified marker, unknown ref untouched"
);

// A ref already inside an anchor stays untouched even if it's in the resolved map.
assert.strictEqual(
  applyTicketRefLinks(
    '<p>See <a href="/detail/project-4/70">HTPR-1234</a> now.</p>',
    new Map([["HTPR-1234", 15]])
  ),
  '<p>See <a href="/detail/project-4/70">HTPR-1234</a> now.</p>',
  "existing anchor untouched"
);

// A ticketNumber that resolves to more than one project (spans teams) is
// ambiguous — dropped from the map entirely rather than picking one at random.
assert.deepStrictEqual(
  buildUnambiguousRefMap([
    { ticketNumber: "HTPR-1234", projectId: 15 },
    { ticketNumber: "HTPR-1234", projectId: 42 },
    { ticketNumber: "INNE-999", projectId: 7 },
  ]),
  new Map([["INNE-999", 7]]),
  "ambiguous ref (multiple projectIds) is absent from the map"
);

// markAiDetailAnchors: model-authored detail anchor gets stamped
assert.strictEqual(
  markAiDetailAnchors('<a href="/detail/project-15/3948">HTPR-3948</a>'),
  '<a data-ai-linkified="1" href="/detail/project-15/3948">HTPR-3948</a>',
  "unmarked detail anchor gets the marker"
);
// already-marked anchor is untouched (no double stamp)
assert.strictEqual(
  markAiDetailAnchors('<a data-ai-linkified="1" href="/detail/project-15/3948">HTPR-3948</a>'),
  '<a data-ai-linkified="1" href="/detail/project-15/3948">HTPR-3948</a>',
  "already-marked anchor unchanged"
);
// non-detail anchor is untouched
assert.strictEqual(
  markAiDetailAnchors('<a href="https://example.com/x">x</a>'),
  '<a href="https://example.com/x">x</a>',
  "non-detail anchor unchanged"
);

console.log("ticketRefLinker: all checks passed");
