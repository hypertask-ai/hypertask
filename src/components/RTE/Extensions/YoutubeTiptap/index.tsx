import { mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { YoutubeNodeView } from "./YoutubeNodeView";
import {
  getEmbedUrlFromYoutubeUrl,
  isValidYoutubeUrl,
  YOUTUBE_REGEX_GLOBAL,
} from "@/utils/helperFunctions/getYoutubeEmbedURL";

export interface YoutubeOptions {
  addPasteHandler: boolean;
  allowFullscreen: boolean;
  autoplay: boolean;
  ccLanguage?: string;
  ccLoadPolicy?: boolean;
  controls: boolean;
  disableKBcontrols: boolean;
  enableIFrameApi: boolean;
  endTime: number;
  height: number;
  interfaceLanguage?: string;
  ivLoadPolicy: number;
  loop: boolean;
  modestBranding: boolean;
  HTMLAttributes: Record<string, any>;
  inline: boolean;
  nocookie: boolean;
  origin: string;
  playlist: string;
  progressBarColor?: string;
  width: number;
}
declare type SetYoutubeVideoOptions = {
  src: string;
  width?: number;
  height?: number;
  start?: number;
};
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    youtube: {
      setYoutubeVideo: (options: SetYoutubeVideoOptions) => ReturnType;
    };
  }
}

export const Youtube = Node.create<YoutubeOptions>({
  name: "youtube",
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
        tag: 'div.video-wrapper iframe[src*="youtube.com"]',
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
        tag: 'iframe[src*="youtube.com"]',
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
    const embedUrl = getEmbedUrlFromYoutubeUrl({
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
    return ReactNodeViewRenderer(YoutubeNodeView);
  },

  addCommands() {
    return {
      setYoutubeVideo:
        (options: SetYoutubeVideoOptions) =>
        ({ commands }) => {
          if (!isValidYoutubeUrl(options.src)) {
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
        key: new PluginKey("youtubeEmbedPlugin"),
        props: {
          handlePaste: (view, event) => {
            if (!isShiftPressed) {
              const text = event.clipboardData?.getData("text/plain");
              if (text && YOUTUBE_REGEX_GLOBAL.test(text)) {
                const embedSrc = getEmbedUrlFromYoutubeUrl({ url: text });
                console.log("🚀 ~ addProseMirrorPlugins ~ embedSrc:", embedSrc);

                this.editor.commands.setYoutubeVideo({ src: text });
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
              if (text && YOUTUBE_REGEX_GLOBAL.test(text)) {
                const embedSrc = getEmbedUrlFromYoutubeUrl({ url: text });
                console.log("🚀 ~ addProseMirrorPlugins ~ embedSrc:", embedSrc);
                const coordinates = view.posAtCoords({
                  left: event.clientX,
                  top: event.clientY,
                });
                if (coordinates) {
                  this.editor.commands.setYoutubeVideo({ src: text });
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
