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
        placement: "auto-start",
        zIndex: 10001,
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
