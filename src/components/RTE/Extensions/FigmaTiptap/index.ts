import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import {
  FIGMA_CONNECTION_VERSION_COOKIE,
  FIGMA_OAUTH_START_PATH,
  FIGMA_OEMBED_PATH,
} from '@/lib/figma/paths';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figma: {
      setFigma: (options: { src: string }) => ReturnType;
      unsetFigma: () => ReturnType;
    };
  }
}

const figmaRegex =
  /https:\/\/[\w\.-]+\.?figma.com\/([\w-]+)\/([0-9a-zA-Z]{22,128})(?:\/.*)?$/;

type FigmaPreviewData = {
  canConnectFigma?: boolean;
  height?: number;
  previewImages?: { name: string; url: string }[];
  thumbnailUrl?: string;
  title?: string;
  width?: number;
};

// ProseMirror can recreate a node view several times together, so share only
// requests made under the same Figma authorization state and only in flight.
const oembedRequests = new Map<string, Promise<FigmaPreviewData>>();

const getFigmaConnectionVersion = () => {
  const prefix = `${FIGMA_CONNECTION_VERSION_COOKIE}=`;
  const cookie = document.cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return cookie?.slice(prefix.length) ?? '';
};

export const fetchFigmaOembed = (
  figmaUrl: string,
): Promise<FigmaPreviewData> => {
  const connectionVersion = getFigmaConnectionVersion();
  const cacheKey = `${connectionVersion}:${figmaUrl}`;
  const inFlight = oembedRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = fetch(
    `${FIGMA_OEMBED_PATH}?url=${encodeURIComponent(figmaUrl)}`,
  ).then(async (response) => {
    if (!response.ok) throw new Error('Figma preview unavailable');
    const data: FigmaPreviewData = await response.json();
    if (getFigmaConnectionVersion() !== connectionVersion) {
      throw new Error('Figma connection changed');
    }
    return data;
  });

  oembedRequests.set(cacheKey, request);
  const clearSettledRequest = () => {
    if (oembedRequests.get(cacheKey) === request) {
      oembedRequests.delete(cacheKey);
    }
  };
  void request.then(clearSettledRequest, clearSettledRequest);
  return request;
};

export const renderFigmaPreview = (
  preview: HTMLButtonElement,
  affordance: HTMLSpanElement,
  data: FigmaPreviewData,
  isCurrent = () => true,
) => {
  const images = Array.isArray(data.previewImages)
    ? data.previewImages.slice(0, 6)
    : [];
  const markPreviewReady = () => {
    affordance.textContent = 'Click to open the live file';
    affordance.className =
      'absolute bottom-2 right-3 text-[12px] text-white/90 opacity-0 transition-opacity drop-shadow-md';
    preview.addEventListener('mouseenter', () => {
      affordance.classList.replace('opacity-0', 'opacity-100');
    });
    preview.addEventListener('mouseleave', () => {
      affordance.classList.replace('opacity-100', 'opacity-0');
    });
  };

  if (images.length > 0) {
    const gallery = document.createElement('span');
    let activated = false;
    gallery.className =
      'absolute inset-0 flex items-center justify-center gap-1 overflow-hidden bg-cardBackground p-1';
    images.forEach(({ name, url }) => {
      const image = document.createElement('img');
      image.alt = name || 'Figma frame';
      image.className = 'h-full min-w-0 flex-1 object-contain';
      image.onload = () => {
        if (activated || !isCurrent()) return;
        activated = true;
        preview.prepend(gallery);
        markPreviewReady();
      };
      image.onerror = () => image.remove();
      gallery.append(image);
      image.src = url;
    });
  } else if (data.thumbnailUrl) {
    const image = document.createElement('img');
    image.alt = data.title ? `${data.title} Figma preview` : 'Figma preview';
    image.className = 'absolute inset-0 h-full w-full object-cover';
    image.onload = () => {
      if (!isCurrent()) return;
      const ratio =
        Number(data.width) > 0 && Number(data.height) > 0
          ? `${data.width}/${data.height}`
          : `${image.naturalWidth}/${image.naturalHeight}`;
      preview.style.aspectRatio = ratio;
      preview.prepend(image);
      markPreviewReady();
    };
    image.src = data.thumbnailUrl;
  }
};

const createEmbedSrc = (url: string) => {
  const embedUrl = new URL('https://www.figma.com/embed');
  const projectName = extractFigmaName(url);

  embedUrl.searchParams.set('embed_host', 'tiptap');
  embedUrl.searchParams.set('embed_origin', window.location.origin);
  embedUrl.searchParams.set('url', url);
  if(projectName) {
    const nospaces = projectName?.replace(/\s/g, '');
    embedUrl.searchParams.set('embed_title', nospaces);
  }
  return embedUrl.toString();
};

function extractFigmaName(url:string) {
  // Extract the design name portion from the URL
  const match = url.match(/\/design\/[^/]+\/([^?]+)/);
  if (!match) return null;
  
  // Get the encoded name and decode it
  const encodedName = match[1];
  
  // Replace hyphens with spaces
  return encodedName
}


export const Figma = Node.create({
  name: 'figma',
  group: 'block',
  atom: true,

  addCommands() {
    return {
      setFigma:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },

      unsetFigma:
        () =>
        ({ commands }) => {
          return commands.deleteRange({
            from: 0,
            to: -1,
          });
        },
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
      
    };
  },

  // biome-ignore lint/style/useNamingConvention: "This is a TipTap extension property"
  parseHTML() {
    return [
      {
        tag: 'iframe[src*="figma.com"]',
      },
    ];
  },

  // biome-ignore lint/style/useNamingConvention: "This is a TipTap extension property"
  renderHTML({ HTMLAttributes }) {
    return [
      'iframe',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        allowfullscreen: 'true',
        // maxWidth:"100%"
      }),
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('div');
      const preview = document.createElement('button');
      const affordance = document.createElement('span');
      const abortController = new AbortController();
      let iframe: HTMLIFrameElement | null = null;
      let connectLink: HTMLAnchorElement | null = null;
      const attributes = mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        { allowfullscreen: 'true' }
      );

      preview.type = 'button';
      preview.dataset.figmaEmbedPreview = 'true';
      // The preview takes its height from the thumbnail, so a wide flat design
      // does not sit in a tall letterboxed well.
      preview.className =
        'relative block aspect-[16/9] max-h-[500px] w-[95%] cursor-pointer overflow-hidden rounded-[4px] bg-cardBackground outline-none hover:opacity-95';
      preview.setAttribute('aria-label', 'Load live Figma embed');
      affordance.className =
        'absolute inset-0 flex items-center justify-center text-[13px] text-text-light-gray';
      affordance.textContent = 'Click to load live Figma';
      preview.append(affordance);
      dom.append(preview);

      const loadLiveEmbed = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (iframe) return;

        abortController.abort();
        iframe = document.createElement('iframe');
        Object.entries(attributes).forEach(([name, value]) => {
          // Match ProseMirror's renderSpec: a null/undefined attr is omitted, not
          // stringified into src="null".
          if (value !== null && value !== undefined) {
            iframe?.setAttribute(name, value);
          }
        });
        dom.replaceChildren(iframe);
      };

      preview.addEventListener('click', loadLiveEmbed);

      try {
        const embedUrl = new URL(String(attributes.src));
        const figmaUrl = embedUrl.searchParams.get('url');

        if (figmaUrl) {
          fetchFigmaOembed(figmaUrl)
            .then((data) => {
              if (iframe || abortController.signal.aborted) return;
              renderFigmaPreview(
                preview,
                affordance,
                data,
                () => !iframe && !abortController.signal.aborted,
              );

              if (data.canConnectFigma) {
                const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                connectLink = document.createElement('a');
                connectLink.href = `${FIGMA_OAUTH_START_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
                connectLink.className =
                  'mt-2 inline-flex text-dense font-semibold text-white-black hover:text-text-light-gray focus-visible:outline-none';
                connectLink.textContent = 'Connect Figma to preview';
                connectLink.setAttribute('contenteditable', 'false');
                connectLink.addEventListener('click', (event) =>
                  event.stopPropagation(),
                );
                dom.append(connectLink);
              }
            })
            .catch(() => {});
        }
      } catch {
        // The placeholder remains clickable when the stored embed URL is invalid.
      }

      return {
        dom,
        update: (updatedNode) =>
          updatedNode.type === node.type &&
          updatedNode.attrs.src === node.attrs.src,
        ignoreMutation: (mutation) => dom.contains(mutation.target),
        // Without this ProseMirror handles the mousedown first and leaves the
        // atomic node selected, so the next keystroke replaces the embed.
        stopEvent: (event) => {
          // `Node` here is Tiptap's, so reach for the DOM one explicitly.
          const target = event.target as globalThis.Node | null;
          if (connectLink?.contains(target)) return true;
          return (
            preview.contains(target) &&
            (event.type === "mousedown" ||
              event.type === "mouseup" ||
              event.type === "click")
          );
        },
        destroy: () => abortController.abort(),
      };
    };
  },

  // addInputRules() {
  //   return [
  //     new InputRule({
  //       find: figmaRegex,
  //       handler: ({ match, commands }) => {
  //         const url = match[0];
  //         const embedSrc = createEmbedSrc(url);

  //         commands.setFigma({ src: embedSrc });
  //       },
  //     }),
  //   ];
  // },

  addProseMirrorPlugins() {
    let isShiftPressed = false; // Track if Shift is pressed during paste
    return [
      new Plugin({
        key: new PluginKey('figmaEmbedPlugin'),
        props: {
          handlePaste: (view, event) => {
            if (!isShiftPressed) {
              const text = event.clipboardData?.getData('text/plain');
              if (text && figmaRegex.test(text)) {
                const embedSrc = createEmbedSrc(text);

                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    this.type.create({ src: embedSrc })
                  )
                );
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
          // biome-ignore lint/style/useNamingConvention: "This is a TipTap extension property"
          handleDOMEvents: {
            drop: (view, event) => {
              if (!view.editable) return false;
              const text = event.dataTransfer?.getData('text/plain');
              if (text && figmaRegex.test(text)) {
                const embedSrc = createEmbedSrc(text);
                const coordinates = view.posAtCoords({
                  left: event.clientX,
                  top: event.clientY,
                });
                if (coordinates) {
                  view.dispatch(
                    view.state.tr.insert(
                      coordinates.pos,
                      this.type.create({ src: embedSrc })
                    )
                  );
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
