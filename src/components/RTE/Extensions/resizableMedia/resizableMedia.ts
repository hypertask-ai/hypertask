import { mergeAttributes, Node, nodeInputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { getMediaPasteDropPlugin } from "./mediaPasteDropPlugin";
import { ResizableMediaNodeView } from "./ResizableMediaNodeView";
import { normalizeImageSource } from "@/utils/helperFunctions/normalizeImageSource";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    resizableMedia: {
      /**
       * Set media
       */
      setMedia: (options: {
        "media-type": "img" | "video";
        src: string;
        alt?: string;
        title?: string;
        width?: string;
        height?: string;
        isLoading?: boolean;
      }) => ReturnType;
    };
  }
}

export interface MediaOptions {
  inline?: boolean;
  allowBase64: boolean;
  HTMLAttributes: Record<string, any>;
  uploadFn: (file: File) => Promise<string>;
  onUploadStart?: () => void;
  onUploadEnd?: () => void;
}

export const IMAGE_INPUT_REGEX =
  /(?:^|\s)(!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\))$/;

export const VIDEO_INPUT_REGEX =
  /!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\)/;

export const ResizableMedia = Node.create<MediaOptions>({
  name: "resizableMedia",
  group: "inline",
  inline: true,
  draggable: false,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      uploadFn: async (file: File) => {
        // Default implementation returns empty string
        console.warn("No upload function provided to ResizableMedia extension");
        return "";
      },
      allowBase64: false,
      onUploadStart: () => {},
      onUploadEnd: () => {},
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
      "media-type": {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: "100%",
      },

      height: {
        default: "auto",
      },
      dataAlign: {
        default: "left", // 'left' | 'center' | 'right'
      },
      dataFloat: {
        default: null, // 'left' | 'right'
      },
      isLoading: {
        default: false,
        parseHTML: () => false,
        renderHTML: (attributes) => {
          if (!attributes.isLoading) {
            return {};
          }

          return {
            "data-loading": "true",
          };
        },
      },
      uploadId: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]:not([src^="data:"])',
        getAttrs: (el) => ({
          src: normalizeImageSource(
            (el as HTMLImageElement).getAttribute("src") ?? "",
          ),
          "media-type": "img",
        }),
      },
      {
        tag: "video",
        getAttrs: (el) => ({
          src: (el as HTMLVideoElement).getAttribute("src"),
          "media-type": "video",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { "media-type": mediaType } = HTMLAttributes;
    const toMerge = {
      ...HTMLAttributes,
      ...(mediaType === "img"
        ? { src: normalizeImageSource(HTMLAttributes.src) }
        : {}),
      style: `height: ${HTMLAttributes.height}px; width: ${HTMLAttributes.width}px;`,
    };

    if (mediaType === "img") {
      return [
        "img",
        mergeAttributes(this.options.HTMLAttributes, toMerge, {
          loading: "lazy",
        }),
      ];
    }

    if (mediaType === "video") {
      return [
        "video",
        { controls: "true", style: "width: 100%", ...HTMLAttributes },
        ["source", HTMLAttributes],
      ];
    }

    if (!mediaType)
      console.error(
        "TiptapMediaExtension-renderHTML method: Media Type not set, going default with image",
      );

    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        loading: "lazy",
      }),
    ];
  },
  addCommands() {
    return {
      setMedia:
        (options) =>
        ({ commands }) => {
          const { "media-type": mediaType } = options;

          if (mediaType === "img") {
            return commands.insertContent({
              type: this.name,
              attrs: {
                ...options,
                src: normalizeImageSource(options.src),
              },
            });
          }
          if (mediaType === "video") {
            return commands.insertContent({
              type: this.name,
              attrs: {
                ...options,
                controls: "true",
              },
            });
          }

          if (!mediaType)
            console.error(
              "TiptapMediaExtension-setMedia: Media Type not set, going default with image",
            );

          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableMediaNodeView);
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: IMAGE_INPUT_REGEX,
        type: this.type,
        getAttributes: (match) => {
          const [, , alt, src, title] = match;

          return {
            src: normalizeImageSource(src),
            alt,
            title,
            "media-type": "img",
          };
        },
      }),
      nodeInputRule({
        find: VIDEO_INPUT_REGEX,
        type: this.type,
        getAttributes: (match) => {
          const [, , src] = match;

          return {
            src,
            "media-type": "video",
          };
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [getMediaPasteDropPlugin(this.options)];
  },
});
