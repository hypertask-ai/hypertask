import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { HtmlBlockView } from "./HtmlBlockView";
import { decodeHtmlPayload, encodeHtmlPayload } from "./codec";

export const HTML_BLOCK_TAG_ATTR = "data-html-block";
export const HTML_BLOCK_PAYLOAD_ATTR = "data-html";

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
