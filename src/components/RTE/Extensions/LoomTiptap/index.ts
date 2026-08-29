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

// Loom's own Copy Link button produces `?sid=<uuid>`, and adding a start time or
// arriving from an app adds `&t=` / `?source=`. The old pattern only tolerated a
// bare URL or exactly `?sid=<uuid>`, so any of those paste as plain text and no
// video ever appears (HTPR-3940). Accept anything after the id.
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
    // The captured id, not `split("/").pop()`: the tail of a share link carries
    // the query string, so the old code built `.../embed/<id>?sid=...`.
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

  // parseHTML() {
  //   console.log("🚀 ~ loomEmbed parseHTML called");
  //   return [
  //     {
  //       tag: 'iframe[src*="loom.com"]',
  //     },
  //   ];
  // },

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
      // Fallback for direct iframes (in case they exist in content)
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
    let isShiftPressed = false; // Track if Shift is pressed during paste
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
                event.preventDefault(); // Prevent default paste behavior
                return true; // Indicate that we handled the paste event
              }
            }

            isShiftPressed = false; // Reset flag after handling paste
            return false; // Allow default behavior for Ctrl+Shift+V or invalid Figma URLs
          },
          handleKeyDown: (view, event) => {
            if (event.shiftKey) {
              isShiftPressed = true; // Set flag for Shift + Ctrl + V
            }

            return false; // Allow default behavior for other key presses
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
