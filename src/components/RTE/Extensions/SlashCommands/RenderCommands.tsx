import { ReactRenderer } from "@tiptap/react";
import tippy from "tippy.js";
import CommandsList from "./CommandsList";
import { stableClientRect } from "../../suggestionAnchor";

const renderItems = () => {
  let component:any;
  let popup:any;
  let getClientRect: any;
  const anchor = stableClientRect(() => getClientRect?.());

  return {
    onStart: (props:any) => {
      getClientRect = props.clientRect;
      // Destroy any stale popup/component first (mirrors the mention renderer).
      // Without this, a re-triggered suggestion can orphan a tippy instance,
      // which shows up as the menu "disappearing" intermittently.
      if (popup && popup[0]) popup[0].destroy();
      if (component) component.destroy();

      component = new ReactRenderer(CommandsList, {
        props,
        editor: props.editor
      });

      popup = tippy("body", {
        getReferenceClientRect: anchor,
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: "manual",
        // Slash commands are shared by editors at both edges of the viewport:
        // task creation starts near the top, while chat/comment composers sit
        // near the bottom. Let Popper choose the side with more usable space,
        // then keep the menu inside the visual viewport. HTPR-4568/5392.
        placement: "auto-start",
        popperOptions: {
          strategy: "fixed",
          modifiers: [
            {
              name: "flip",
              options: {
                allowedAutoPlacements: ["bottom-start", "top-start"],
                fallbackPlacements: ["bottom-start", "top-start"],
                padding: 12,
              },
            },
            {
              name: "preventOverflow",
              options: { padding: 12, altAxis: true },
            },
          ],
        },
      });
    },
    onUpdate(props:any) {
      getClientRect = props.clientRect;
      component?.updateProps(props);

      if (popup && popup[0]) {
        // Keep the stable anchor: props.clientRect can momentarily resolve
        // null mid-typing, and tippy reads that as "no reference" and jumps
        // the menu to the document origin. HTPR-3383.
        popup[0].setProps({
          getReferenceClientRect: anchor
        });
      }
    },
    onKeyDown(props:any) {
      if (props.event.key === "Escape") {
        popup?.[0]?.hide();

        return true;
      }

      const handled = component?.ref?.onKeyDown(props);
      // When the menu consumes a key — Enter to pick a skill, arrows to
      // navigate — stop it from bubbling to the editor container's own key
      // handlers. The AI chat sends on Enter via a container-level handler
      // (useAiChat tiptapKeydown); without this, selecting a skill would ALSO
      // fire the send, because the popup (and its DOM marker) is torn down by
      // the time that bubbled handler runs. Selecting a skill must only insert
      // "/slug " so the user can keep typing their prompt, then Enter sends.
      if (handled) {
        props.event.stopPropagation();
      }
      return handled;
    },
    onExit() {
      popup&&popup[0]?.destroy();
      component?.destroy();
    }
  };
};

export default renderItems;
