import { mergeAttributes } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";

import { buildRichTextMentionHref } from "@/utils/helperFunctions/richTextMention";

export const LinkableMention = Mention.extend({
  addAttributes() {
    const parentAttributes =
      typeof this.parent === "function" ? this.parent() : {};

    return {
      ...parentAttributes,
      uniqueIndex: { default: "" },
      projectId: { default: "" },
      text: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("text") || element.textContent || "",
      },
    };
  },

  parseHTML() {
    return [
      { tag: `span[data-type="${this.name}"]`, priority: 1000 },
      { tag: `a[data-type="${this.name}"]`, priority: 1000 },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attributes = mergeAttributes(
      { "data-type": this.name },
      this.options.HTMLAttributes,
      HTMLAttributes,
    );
    const label = node.attrs.text || node.attrs.id || "";
    const href = buildRichTextMentionHref({
      label: node.attrs.label,
      dataId: node.attrs.id,
      projectId: node.attrs.projectId,
      uniqueIndex: node.attrs.uniqueIndex,
    });

    return href
      ? ["a", mergeAttributes({ href }, attributes), label]
      : ["span", attributes, label];
  },
});
