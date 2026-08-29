import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { HtmlBlockView } from "./HtmlBlockView";
import { decodeHtmlPayload, encodeHtmlPayload } from "./codec";

// Marker + payload attributes. Kept in sync with the server wrapper in
// src/utils/controllers/pages/htmlCanvas.ts and the sanitizer allow-list.
export const HTML_BLOCK_TAG_ATTR = "data-html-block";
export const HTML_BLOCK_PAYLOAD_ATTR = "data-html";

// An atom block whose entire payload is the agent's raw HTML, carried opaquely
// as a base64 attribute. Because it is `atom: true`, ProseMirror treats the node
// as indivisible and never parses (or strips) the HTML inside — that is what
// lets arbitrary exploration-grade HTML survive TipTap's schema. It renders in a
// sandboxed iframe (see HtmlBlockView).
export const HtmlBlock = Node.create({
  name: "htmlBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      html: {
        default: "",
        parseHTML: (element) =>
          decodeHtmlPayload(element.getAttribute(HTML_BLOCK_PAYLOAD_ATTR) || ""),
        renderHTML: (attributes) => ({
          [HTML_BLOCK_PAYLOAD_ATTR]: encodeHtmlPayload((attributes.html as string) || ""),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[${HTML_BLOCK_TAG_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { [HTML_BLOCK_TAG_ATTR]: "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(HtmlBlockView);
  },
});
