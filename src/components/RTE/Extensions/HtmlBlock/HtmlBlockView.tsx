"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import { HtmlCanvasFrame } from "./HtmlCanvasFrame";

export function HtmlBlockView({ node }: NodeViewProps) {
  const html = (node.attrs.html as string) || "";

  if (!html.trim()) {
    return (
      <NodeViewWrapper className="ht-html-block" data-drag-handle>
        <div className="my-2 rounded-lg border border-dashed border-light-black-border-1 px-4 py-6 text-center text-meta text-text-light-gray">
          Empty HTML block
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="ht-html-block" data-drag-handle>
      <HtmlCanvasFrame
        html={html}
        className="my-2 block w-full rounded-lg bg-white"
      />
    </NodeViewWrapper>
  );
}
