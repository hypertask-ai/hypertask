// HTPR-5898. A page picked from the @ menu has to survive three hops before it
// is a working link: the picker builds the mention node's attributes, the
// comment/description save rewrites the mention span into an <a href>, and the
// href itself is built from those attributes. Get the id/label pair wrong and
// buildRichTextMentionHref simply returns null: the chip still renders, just as
// unlinked text, and nothing throws. These assertions are what fails instead.
import assert from "node:assert/strict";
import test from "node:test";

import { LinkableMention } from "../src/components/RTE/Extensions/LinkableMention";
import { mentionAttrsForItem } from "../src/components/RTE/mentionAttrs";
import { buildRichTextMentionHref } from "../src/utils/helperFunctions/richTextMention";
import { normalizeRichTextStructure } from "../src/utils/helperFunctions/normalizeRichTextStructure";
import {
  firstSelectableMentionIndex,
  isSelectableMentionItem,
} from "../src/components/RTE/mentionNavigation";

const PUBLIC_ID = "cmtijln8s00000akke4i2wmc2";
const pageRow = {
  type: "page",
  id: PUBLIC_ID,
  name: "Wireframe: @ mention dropdown with Pages group",
  ticketNumber: "HTPR-5898",
};

// The span the editor serialises for those attrs: `id` -> data-id, `label` ->
// data-label, and custom attributes render under their own lowercased name.
// ProseMirror escapes attribute values and text on serialisation, so the input
// this function builds mirrors what actually reaches the save path.
const escape = (value: string) =>
  value.replace(/[&<>"]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;",
  );

const spanFor = (attrs: ReturnType<typeof mentionAttrsForItem>) => {
  const label = escape(attrs.text ?? String(attrs.id));
  return `<p>see <span data-type="mention" class="mention" data-id="${escape(String(attrs.id))}" data-label="${attrs.label}" text="${label}" uniqueindex="" projectid="">${label}</span></p>`;
};

test("a picked page becomes a /page/<publicId> link showing its title", () => {
  const attrs = mentionAttrsForItem(pageRow);
  assert.deepEqual(attrs, {
    id: PUBLIC_ID,
    label: "page",
    text: pageRow.name,
  });

  assert.equal(
    buildRichTextMentionHref({ label: attrs.label, dataId: attrs.id }),
    `https://app.hypertask.ai/page/${PUBLIC_ID}`,
  );

  const rendered = normalizeRichTextStructure(spanFor(attrs));
  assert.match(
    rendered,
    new RegExp(`<a href="https://app.hypertask.ai/page/${PUBLIC_ID}"`),
  );
  assert.ok(
    rendered.includes(pageRow.name),
    `link text should stay the page title, got: ${rendered}`,
  );
  // The chip's readable label lives in `text`, and LinkableMention falls back to
  // the raw publicId without it. normalizeRichTextStructure rebuilds the node as
  // an anchor from an attribute allow-list, so dropping `text` from that list
  // would silently turn every posted page mention into a cuid.
  assert.match(rendered, /text="Wireframe: @ mention dropdown with Pages group"/);
});

test("the mention node still declares the text attribute the chip reads from", () => {
  // Without it the editor discards mentionAttrsForItem's `text` on insert and
  // every page chip renders its raw cuid. The allow-list assertion above cannot
  // see that: it starts from a span that already has the attribute.
  const declared = LinkableMention.config.addAttributes?.call({
    parent: () => ({}),
    name: "mention",
  } as never);
  assert.ok(
    declared && "text" in declared,
    `LinkableMention must declare a text attribute, got: ${Object.keys(declared ?? {})}`,
  );
});

test("a page title carrying quotes or angle brackets cannot break out of the link", () => {
  const attrs = mentionAttrsForItem({
    ...pageRow,
    name: 'Spec "v2" <script>alert(1)</script>',
  });
  const rendered = normalizeRichTextStructure(spanFor(attrs));
  assert.ok(
    !/<script/i.test(rendered),
    `no live script tag may survive, got: ${rendered}`,
  );
  assert.ok(rendered.includes("&quot;"), `quotes must stay escaped: ${rendered}`);
});

test("an empty page id yields no link rather than /page/", () => {
  assert.equal(buildRichTextMentionHref({ label: "page", dataId: "" }), null);
  assert.equal(buildRichTextMentionHref({ label: "page", dataId: "   " }), null);
});

test("the Pages group header is skipped by keyboard navigation", () => {
  assert.equal(isSelectableMentionItem({ type: "pageHeading" }), false);
  assert.equal(isSelectableMentionItem({ type: "page" }), true);
  assert.equal(
    firstSelectableMentionIndex([
      { type: "taskHeading" },
      { type: "pageHeading" },
      { type: "page" },
    ]),
    2,
  );
});

test("the other mention kinds keep the attributes they had before the extraction", () => {
  assert.deepEqual(
    mentionAttrsForItem({
      type: "task",
      project_id: 15,
      index: 5898,
      ticketNumber: "HTPR-5898",
      name: "Page mentions",
    }),
    {
      projectId: 15,
      uniqueIndex: 5898,
      id: "HTPR-5898 Page mentions",
      label: "task",
    },
  );
  assert.deepEqual(
    mentionAttrsForItem({ type: "name", id: 6, name: "Valentin Yeo" }),
    { id: "Valentin Yeo", label: "name-6" },
  );
  assert.deepEqual(
    mentionAttrsForItem({ type: "agent", id: "abc", name: "Dev 3 (HT)" }),
    { id: "Dev 3 (HT)", label: "agent-abc" },
  );
  assert.deepEqual(
    mentionAttrsForItem({ type: "project", id: 15, identifier: "HTPR", name: "Product" }),
    { id: "HTPR Product", projectId: 15, label: "project-15" },
  );
});
