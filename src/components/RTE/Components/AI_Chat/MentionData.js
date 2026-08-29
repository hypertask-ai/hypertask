import { ReactRenderer } from "@tiptap/react";
import tippy from "tippy.js";
import MentionList from "../../Components/AI_Chat/MentionList";
import axios from "axios";
import { stableClientRect } from "../../suggestionAnchor";
import { mentionCommand } from "../../mentionCommand";

// Function that accepts contextCallback and returns the suggestion configuration
const createMentionData = (contextCallback, getProjectId) => ({
  command: mentionCommand,
  items: async ({ query }) => {
    try {
      const projectId = getProjectId?.();
      const url = `/api/ai/chat/mention?param=${encodeURIComponent(
        query || "all"
      )}${projectId ? `&projectId=${projectId}` : ""}`;
      const res = await axios.get(url);
      if (res?.data?.length > 0) return res.data;
      return [{ type: "no-results", name: "No results found" }];
    } catch {
      return [{ type: "error", name: "Error loading results" }];
    }
  },
  allowSpaces: true,

  render: () => {
    let component;
    let popup;
    let getClientRect;
    const anchor = stableClientRect(() => getClientRect?.());

    return {
      onStart: (props) => {
        getClientRect = props.clientRect;
        if (popup && popup[0]) {
          popup[0].destroy();
        }
        if (component) {
          component.destroy();
        }

        component = new ReactRenderer(MentionList, {
          props: {
            ...props,
            contextCallback: contextCallback,
          },
          editor: props.editor,
        });

        popup = tippy("body", {
          getReferenceClientRect: anchor,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: "bottom-start",
          flipBehavior: ["flip"],
          zIndex: 9999,
        });
      },

      onUpdate(props) {

        getClientRect = props.clientRect;
        component.updateProps(props);

        if (popup && popup[0]) {
          popup[0].setProps({
            getReferenceClientRect: anchor,
          });
        }
      },

      onKeyDown(props) {
        if (props.event.key === "Escape") {
          popup[0]?.hide();
          return true; // Return true to indicate the event was handled
        }

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
});

// Export the function
export { createMentionData };

// Default export for backwards compatibility (without callback)
export default createMentionData(null);
