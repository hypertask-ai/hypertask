/* eslint-disable import/no-anonymous-default-export */
import { ReactRenderer } from "@tiptap/react";
import tippy from "tippy.js";
import MentionList from "./MentionList";
import { stableClientRect } from "./suggestionAnchor";
import axios from "axios";
import { mentionCommand } from "./mentionCommand";

export default {
  command: mentionCommand,
  items: async ({ query }) => {
    const getAllTasks = async (data) => {
      try {
        if(data.startsWith(" ")) {
          return [{ type: "hide", name: "hiding mention list" }];
        }
        let projectId = localStorage.getItem("MENTION_PROJECT_ID");
        let url = `/api/tasks/searchByParam?param=${data}&projectId=${projectId}`;
        const result = await axios.get(url);
        if (result && result.data) {
          return result.data;
        } else {
          console.log("🤔 ~ @Mention: No results found");
          return [];
        }
      } catch (error) {
        console.error("Error fetching tasks:", error);
        return [];
      }
    };

    try {
      const result = await getAllTasks(query ? query : "all");
      if (result && result.length > 0) {
        return result;
      } else {
        return [{ type: "no-results", name: "No results found" }];
      }
    } catch (error) {
      // Return a specific item to signal an error
      return [{ type: "error", name: "Error loading results" }];
    }
  },

  allowSpaces: true,

  render: () => {
    let component;
    let popup;
    // Created once per suggestion, then fed the newest getter on each update, so
    // the remembered rect survives an update that resolves to null (HTPR-3383).
    let getClientRect;
    const anchor = stableClientRect(() => getClientRect?.());

    return {
      onStart: (props) => {
        if (popup && popup[0]) {
          popup[0].destroy();
        }
        if (component) {
          component.destroy();
        }
        // --- FIX ENDS HERE ---

        component = new ReactRenderer(MentionList, {
          props,
          editor: props.editor,
        });

        const isMobile = window.innerWidth <= 768;
        getClientRect = props.clientRect;

        popup = tippy("body", {
          getReferenceClientRect: anchor,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: isMobile ? "top-start" : "bottom-start",
          flipBehavior: isMobile ? [] : ["flip"],
        });
      },

      onUpdate(props) {
        component.updateProps(props);
        getClientRect = props.clientRect;
      },

      onKeyDown(props) {
        if (props.event.key === "Escape") {
          popup[0]?.hide();
          return true; // Return true to indicate the event was handled
        }

        // Pass the event to the MentionList component's handler
        return component?.ref?.onKeyDown(props);
      },

      onExit() {
        if (popup && popup[0]) {
          popup[0].destroy();
        }
        if (component) {
          component.destroy();
        }
      },
    };
  },
};
