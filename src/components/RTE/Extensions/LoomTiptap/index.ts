import { mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { LoomNodeView } from "./LoomNodeView";

interface GetEmbedUrlOptions {
  url: string;
  allowFullscreen?: boolean;
  startAt?: number;
}

interface loomOptions {
  allowFullscreen: boolean;
  height: number;
  HTMLAttributes: Record<string, any>;
  width: number;
}

type SetLoomVideoOptions = {
  src: string;
  width?: number;
  height?: number;
  gifThumbnail?: boolean;
};

const loom_REGEX =
  /^(https?:\/\/)?(www\.)?loom\.com\/share\/([a-f0-9]{32})(?:[/?#].*)?$/i;

const loomEmbedUrl = "https://www.loom.com/embed/";

const isValidloomUrl = (url: string) => {
  return url.match(loom_REGEX);
};

export const getEmbedUrlFromloomUrl = (options: GetEmbedUrlOptions) => {
  const { url } = options;

  if (url.includes("www.loom.com/embed/")) {
    return url;
  }

  const match = isValidloomUrl(url);

  if (!match) {
    return null;
  }

  if (url.includes("loom.com/share")) {
    const id = match[3];

    if (!id) {
      return null;
    }

    return `${loomEmbedUrl}${id}`;
  }

  return url;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    loom: {
      setloomVideo: (options: SetLoomVideoOptions) => ReturnType;
    };
  }
}

export const Loom = Node.create<loomOptions>({
  name: "loom",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      start: {
        default: 0,
      },
      width: {
        default: this.options.width,
      },
      height: {
        default: this.options.height,
      },
    };
  },


  parseHTML() {
    return [
      {
        tag: 'div.video-wrapper iframe[src*="loom.com"]',
        getAttrs: (node) => {
          if (typeof node === "string") return {};

          const element = node as HTMLElement;
          return {
            src: element.getAttribute("src"),
          };
        },
      },
      {
        tag: 'iframe[src*="loom.com"]',
        getAttrs: (node) => {
          if (typeof node === "string") return {};

          const element = node as HTMLElement;
          return {
            src: element.getAttribute("src"),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const embedUrl = getEmbedUrlFromloomUrl({
      url: HTMLAttributes.src,
      allowFullscreen: true,
      startAt: HTMLAttributes.start || 0,
    });

    HTMLAttributes.src = embedUrl;

    return [
      "div",
      { class: "video-wrapper" },
      [
        "iframe",
        mergeAttributes(
          this.options.HTMLAttributes,
          {
            width: this.options.width,
            height: this.options.height,
            allowfullscreen: true,
          },
          HTMLAttributes
        ),
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LoomNodeView);
  },

  addCommands() {
    return {
      setloomVideo:
        (options: SetLoomVideoOptions) =>
        ({ commands }) => {
          if (!isValidloomUrl(options.src)) {
            return false;
          }

          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },

  addProseMirrorPlugins() {
    let isShiftPressed = false;
    return [
      new Plugin({
        key: new PluginKey("loomEmbedPlugin"),
        props: {
          handlePaste: (view, event) => {
            if (!isShiftPressed) {
              const text = event.clipboardData?.getData("text/plain");
              if (text && loom_REGEX.test(text)) {
                const embedSrc = getEmbedUrlFromloomUrl({ url: text });
                console.log("🚀 ~ addProseMirrorPlugins ~ embedSrc:", embedSrc);

                this.editor.commands.setloomVideo({ src: text });
                event.preventDefault();
                return true;
              }
            }

            isShiftPressed = false;
            return false;
          },
          handleKeyDown: (view, event) => {
            if (event.shiftKey) {
              isShiftPressed = true;
            }

            return false;
          },

          handleDOMEvents: {
            drop: (view, event) => {
              if (!view.editable) return false;
              const text = event.dataTransfer?.getData("text/plain");
              if (text && loom_REGEX.test(text)) {
                const embedSrc = getEmbedUrlFromloomUrl({ url: text });
                console.log("🚀 ~ addProseMirrorPlugins ~ embedSrc:", embedSrc);
                const coordinates = view.posAtCoords({
                  left: event.clientX,
                  top: event.clientY,
                });
                if (coordinates) {
                  this.editor.commands.setloomVideo({ src: text });
                  return true;
                }
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
