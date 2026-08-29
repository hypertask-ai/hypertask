import { ReactRenderer } from "@tiptap/react";
import tippy from "tippy.js";
import { clearForcedSnippetPicker } from "@/lib/snippets";
import SnippetsList, { type SnippetsListRef } from "./SnippetsList";
import { stableClientRect } from "../../suggestionAnchor";

const renderItems = () => {
  let component: ReactRenderer<SnippetsListRef> | null = null;
  let popup: ReturnType<typeof tippy> | null = null;
  let getClientRect: any;
  const anchor = stableClientRect(() => getClientRect?.());

  return {
    onStart: (props: any) => {
      getClientRect = props.clientRect;
      popup?.[0]?.destroy();
      component?.destroy();

      component = new ReactRenderer(SnippetsList, {
        props,
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
      });
    },
    onUpdate(props: any) {
      getClientRect = props.clientRect;
      component?.updateProps(props);
      popup?.[0]?.setProps({ getReferenceClientRect: anchor });
    },
    onKeyDown(props: any) {
      if (props.event.key === "Escape") {
        popup?.[0]?.hide();
        return true;
      }
      return component?.ref?.onKeyDown(props) ?? false;
    },
    onExit(props: any) {
      clearForcedSnippetPicker(props.editor);
      popup?.[0]?.destroy();
      component?.destroy();
      popup = null;
      component = null;
    },
  };
};

export default renderItems;
