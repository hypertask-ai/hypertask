import assert from "node:assert";
// @ts-expect-error Node strip-types checks require .ts imports without allowImportingTsExtensions.
import { findLinkableTicketRefs, applyTicketRefLinks, buildUnambiguousRefMap, markAiDetailAnchors } from "./ticketRefLinker.ts";

assert.deepStrictEqual(
  findLinkableTicketRefs("<p>See HTPR-1234 for details.</p>"),
  ["HTPR-1234"],
  "plain-text ref found"
);

assert.deepStrictEqual(
  findLinkableTicketRefs(
    '<p>See <a href="/detail/project-4/70">HTPR-1234</a> for details.</p>'
  ),
  [],
  "ref inside existing <a> is skipped"
);

assert.strictEqual(
  applyTicketRefLinks(
    "<p>See HTPR-1234 and INNE-999 for details.</p>",
    new Map([["HTPR-1234", 15]])
  ),
  '<p>See <a href="/detail/project-15/1234" data-ai-linkified="1">HTPR-1234</a> and INNE-999 for details.</p>',
  "resolved ref wrapped with ai-linkified marker, unknown ref untouched"
);

assert.strictEqual(
  applyTicketRefLinks(
    '<p>See <a href="/detail/project-4/70">HTPR-1234</a> now.</p>',
    new Map([["HTPR-1234", 15]])
  ),
  '<p>See <a href="/detail/project-4/70">HTPR-1234</a> now.</p>',
  "existing anchor untouched"
);

assert.deepStrictEqual(
  buildUnambiguousRefMap([
    { ticketNumber: "HTPR-1234", projectId: 15 },
    { ticketNumber: "HTPR-1234", projectId: 42 },
    { ticketNumber: "INNE-999", projectId: 7 },
  ]),
  new Map([["INNE-999", 7]]),
  "ambiguous ref (multiple projectIds) is absent from the map"
);

assert.strictEqual(
  markAiDetailAnchors('<a href="/detail/project-15/3948">HTPR-3948</a>'),
  '<a data-ai-linkified="1" href="/detail/project-15/3948">HTPR-3948</a>',
  "unmarked detail anchor gets the marker"
);
assert.strictEqual(
  markAiDetailAnchors('<a data-ai-linkified="1" href="/detail/project-15/3948">HTPR-3948</a>'),
  '<a data-ai-linkified="1" href="/detail/project-15/3948">HTPR-3948</a>',
  "already-marked anchor unchanged"
);
assert.strictEqual(
  markAiDetailAnchors('<a href="https://example.com/x">x</a>'),
  '<a href="https://example.com/x">x</a>',
  "non-detail anchor unchanged"
);

console.log("ticketRefLinker: all checks passed");
