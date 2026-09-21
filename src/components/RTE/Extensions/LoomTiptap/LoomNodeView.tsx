import React, { useEffect, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { getEmbedUrlFromloomUrl } from ".";

export const LoomNodeView = ({
  node,
  updateAttributes,
  deleteNode,
}: NodeViewProps) => {
  const [embedUrl, setEmbedUrl] = useState<string>("");

  // Process the URL once when the component mounts or when src changes
  useEffect(() => {
    if (node.attrs.src) {
      console.log("🚀 ~ useEffect ~ src:", node.attrs.src);
      // Use the same function that renderHTML uses
      const processedUrl = getEmbedUrlFromloomUrl({
        url: node.attrs.src,
        allowFullscreen: true,
        startAt: node.attrs.start || 0,
      });
      console.log("🚀 ~ useEffect ~ processedUrl:", processedUrl);

      setEmbedUrl(processedUrl ?? "");
    }
  }, [node.attrs.src, node.attrs.start]);

  return (
    <NodeViewWrapper
      as="article"
      className="media-node-view not-prose transition-all ease-in-out w-full"
    >
      <div className="video-wrapper w-full">
        {embedUrl ? (
          <iframe
            src={embedUrl}
            width={node.attrs.width || "100%"}
            height={node.attrs.height || "315"}
            allowFullScreen
          />
        ) : (
          <div className="loom-error p-4 bg-gray-100 text-red-500 rounded">
            {"Unable to load Loom video"}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};
