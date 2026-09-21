import React, { useEffect, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { getEmbedUrlFromYoutubeUrl } from "@/utils/helperFunctions/getYoutubeEmbedURL";

export const YoutubeNodeView = ({ node }: NodeViewProps) => {
  const [embedUrl, setEmbedUrl] = useState<string>("");

  // Process the URL once when the component mounts or when src changes
  useEffect(() => {
    if (node.attrs.src) {
      console.log("🚀 ~ useEffect ~ src:", node.attrs.src);
      // Use the same function that renderHTML uses
      const processedUrl = getEmbedUrlFromYoutubeUrl({
        url: node.attrs.src,
        allowFullscreen: true,
        startAt: node.attrs.start || 0,
      });

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
          <div className="youtube-error p-4 bg-gray-100 text-red-500 rounded">
            {"Unable to load Youtube video"}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};
