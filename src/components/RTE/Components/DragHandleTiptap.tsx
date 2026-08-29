import type { Editor } from "@tiptap/core";
import React, { useMemo } from "react";
import DragHandle from "@tiptap/extension-drag-handle-react";
import { GripVertical } from "lucide-react";

const DragHandleTiptap = ({ editor }: { editor: Editor }) => {
  // Stable config object. The DragHandle's registration effect lists
  // computePositionConfig in its deps, so passing a fresh object each render
  // makes it unregister/re-register its plugin on every re-render. That changes
  // the editor's plugin set, which destroys all plugin views (including an open
  // slash/mention suggestion popup) - the popup would flash then vanish.
  const computePositionConfig = useMemo(
    () => ({ placement: "left-start" as const }),
    []
  );
  return (
    <DragHandle
      editor={editor}
      computePositionConfig={computePositionConfig}
      className="cursor-grab"
    >
      <div className="pr-[9px] ">
        <div className="transition-colors grid place-items-center bg-[#4F5765] rounded h-[22px] w-[18px]">
          <GripVertical color="white" size={14} strokeWidth={1.75} />
        </div>
      </div>
    </DragHandle>
  );
};

export default DragHandleTiptap;
