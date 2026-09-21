import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import axios from "axios";

import {
  createShareLookupUrl,
  type HypertaskUrlMatch,
  parseHypertaskPasteUrl,
} from "./parseHypertaskPasteUrl";

const getTaskData = async (match: HypertaskUrlMatch): Promise<string> => {
  try {
    let response;

    if (match.type === "detail") {
      // For detail URLs: /api/tasks/getTask?project={projectId}&uniqueIndex={id}
      response = await axios.get(
        `/api/tasks/getTask?project=project-${match.id}&uniqueIndex=${match.projectId}`
      );

      if (response.status === 200 && response.data) {
        const { ticketNumber, title } = response.data;
        return ticketNumber
          ? `${ticketNumber.toUpperCase()} | ${title}`.trim()
          : title?.trim();
      }
    } else if (match.type === "share") {
      // For share URLs: /api/share/createShareLink?shareId={id}
      response = await axios.get(createShareLookupUrl(match.id));

      if (response.status === 200 && response.data) {
        const { ticketNumber, title } = response.data.taskShared.task;
        return ticketNumber
          ? `${ticketNumber.toUpperCase()} | ${title}`.trim()
          : title.trim();
      }
    }

    return match.fullUrl;
  } catch (error) {
    console.log("🤔 ~ fetchHypertaskTitle ~ error:", error);
    return match.fullUrl;
  }
};

export const HypertaskPasteRule = Extension.create({
  name: "hypertaskPasteRule",

  addProseMirrorPlugins() {
    let allowRawPaste = false;

    return [
      new Plugin({
        key: new PluginKey("hypertaskPasteRule"),
        props: {
          handlePaste: (view, event) => {
            if (allowRawPaste) {
              allowRawPaste = false;
              return false;
            }
            const clipboardData = event.clipboardData;
            if (!clipboardData) return false;

            const text = clipboardData.getData("text/plain");
            if (!text) return false;

            // Only a standalone Hypertask URL gets the rich task-link
            // treatment. Mixed text belongs to Tiptap's normal paste flow.
            const match = parseHypertaskPasteUrl(text);
            if (!match) return false;

            // Prevent default paste behavior
            event.preventDefault();

            // Get the current position
            const { from, to } = view.state.selection;
            const { schema } = view.state;
            const linkMark = schema.marks.link;

            if (!linkMark) {
              // Fallback: insert as plain text if link mark is not available
              const tr = view.state.tr.replaceWith(from, to, schema.text(text));
              view.dispatch(tr);
              return true;
            }

            // Step 1: Immediately insert a placeholder link with the formatted text if available, otherwise use the original URL
            const placeholderText =
              event.clipboardData
                ?.getData("text/html")
                ?.replace(/<[^>]*>/g, "")
                .trim() || match.fullUrl;
            const mark = linkMark.create({
              href: match.fullUrl,
              target: "_blank",
              class: "task-link",
            });

            const linkNode = schema.text(placeholderText, [mark]);

            // Insert the placeholder and add a space after
            const tr = view.state.tr
              .replaceWith(from, to, linkNode)
              .insertText(" ", from + placeholderText.length);

            view.dispatch(tr);

            // Step 2: Fetch the actual data and replace the placeholder
            getTaskData(match)
              .then((formattedTitle) => {
                // Find the placeholder text in the document
                const currentState = view.state;
                let foundPos = null;

                currentState.doc.descendants((node, pos) => {
                  if (
                    node.isText &&
                    node.text === placeholderText &&
                    node.marks.some(
                      (m) =>
                        m.type === linkMark && m.attrs.href === match.fullUrl
                    )
                  ) {
                    foundPos = pos;
                    return false; // Stop iteration
                  }
                });

                if (foundPos !== null) {
                  // Create the new link node with the actual title
                  const newMark = linkMark.create({
                    href: match.fullUrl,
                    target: "_blank",
                    class: "task-link",
                  });
                  const newLinkNode = schema.text(formattedTitle, [newMark]);

                  // Replace the placeholder with the actual title
                  const replaceTr = currentState.tr.replaceWith(
                    foundPos,
                    foundPos + placeholderText.length,
                    newLinkNode
                  );

                  view.dispatch(replaceTr);
                }
              })
              .catch((error) => {
                console.log("🤔 ~ addProseMirrorPlugins ~ error:", error);
                // On error, replace placeholder with the original URL
                const currentState = view.state;
                let foundPos = null;

                currentState.doc.descendants((node, pos) => {
                  if (
                    node.isText &&
                    node.text === placeholderText &&
                    node.marks.some(
                      (m) =>
                        m.type === linkMark && m.attrs.href === match.fullUrl
                    )
                  ) {
                    foundPos = pos;
                    return false;
                  }
                });

                if (foundPos !== null) {
                  const fallbackMark = linkMark.create({
                    href: match.fullUrl,
                    target: "_blank",
                    class: "task-link",
                  });
                  const fallbackNode = schema.text(match.fullUrl, [
                    fallbackMark,
                  ]);

                  const replaceTr = currentState.tr.replaceWith(
                    foundPos,
                    foundPos + placeholderText.length,
                    fallbackNode
                  );

                  view.dispatch(replaceTr);
                }
              });

            return true;
          },
          handleDOMEvents: {
            keydown: (_view, event) => {
              const isModifierPressed = event.metaKey || event.ctrlKey;
              if (
                isModifierPressed &&
                event.shiftKey &&
                event.keyCode === KeyCodes.V
              ) {
                allowRawPaste = true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
