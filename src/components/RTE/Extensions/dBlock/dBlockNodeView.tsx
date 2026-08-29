/* eslint-disable jsx-a11y/no-static-element-interactions */

import React, { useMemo } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { GripHorizontal, Plus } from "lucide-react";

export const DBlockNodeView: React.FC<NodeViewProps> = ({
  node,
  getPos,
  editor,
}) => {
  const isTable = useMemo(() => {
    const { content } = node.content as any;

    return content[0].type.name === "table";
  }, [node.content]);

  const createNodeAfter = () => {
    // v3: getPos() can return undefined when the node is no longer in the doc
    const currentPos = getPos();
    if (currentPos === undefined) return;
    const pos = currentPos + node.nodeSize;

    editor.commands.insertContentAt(pos, {
      type: "dBlock",
      content: [
        {
          type: "paragraph",
        },
      ],
    });
  };

  return (
    <NodeViewWrapper as="div" className="flex gap-2 items-center group w-full relative">
      <section
        className="flex  pt-[2px] gap-1"
        aria-label="left-menu"
        contentEditable="false"
      >
        <button
          type="button"
          className="d-block-button bg-transparent group-hover:opacity-100"
          onClick={createNodeAfter}
        >
          <Plus size={18} color="white" strokeWidth={1.75}/>
        </button>
        <div
          className="d-block-button bg-transparent group-hover:opacity-100"
          contentEditable={false}
          draggable
          data-drag-handle
        >
          <GripHorizontal size={18} color="white" strokeWidth={1.75}/>
        </div>
      </section>

      <NodeViewContent
        className={`node-view-content py-1 border border-white rounded-sm pl-1 w-full ${isTable ? "ml-6" : ""}`}
      />
    </NodeViewWrapper>
  );
};
