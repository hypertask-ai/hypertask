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

            const match = parseHypertaskPasteUrl(text);
            if (!match) return false;

            event.preventDefault();

            const { from, to } = view.state.selection;
            const { schema } = view.state;
            const linkMark = schema.marks.link;

            if (!linkMark) {
              const tr = view.state.tr.replaceWith(from, to, schema.text(text));
              view.dispatch(tr);
              return true;
            }

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

            const tr = view.state.tr
              .replaceWith(from, to, linkNode)
              .insertText(" ", from + placeholderText.length);

            view.dispatch(tr);

            getTaskData(match)
              .then((formattedTitle) => {
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
                  const newMark = linkMark.create({
                    href: match.fullUrl,
                    target: "_blank",
                    class: "task-link",
                  });
                  const newLinkNode = schema.text(formattedTitle, [newMark]);

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
