import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

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

// HTPR-5149: ProseMirror recreates a node view on re-render, and the oEmbed
// lookup used to ride along with it, so one task open fetched the same Figma
// metadata up to five times. Keyed by the Figma URL and kept for the page's
// life: a design's title and thumbnail do not change while you read a ticket.
//
// The request deliberately carries no abort signal. Each node view has its own
// controller and aborts it on destroy or when the user clicks through to the
// live iframe; passing that signal here would let one node view cancel the
// response every other one is waiting on.
const oembedCache = new Map<string, Promise<any>>();

const fetchFigmaOembed = (figmaUrl: string): Promise<any> => {
  const cached = oembedCache.get(figmaUrl);
  if (cached) return cached;

  const request = fetch(
    `/api/figma/oembed?url=${encodeURIComponent(figmaUrl)}`
  ).then((response) => {
    if (!response.ok) throw new Error('Figma preview unavailable');
    return response.json();
  });

  // A failure must not be cached, or the preview stays broken until reload.
  request.catch(() => oembedCache.delete(figmaUrl));
  oembedCache.set(figmaUrl, request);
  return request;
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
            .then(({ thumbnailUrl, title, width, height }) => {
              if (!thumbnailUrl || iframe || abortController.signal.aborted)
                return;

              const image = document.createElement('img');
              image.alt = title ? `${title} Figma preview` : 'Figma preview';
              image.className = 'absolute inset-0 h-full w-full object-cover';
              image.onload = () => {
                if (iframe) return;
                // Follow the design's own proportions once we know them.
                const ratio =
                  Number(width) > 0 && Number(height) > 0
                    ? `${width}/${height}`
                    : `${image.naturalWidth}/${image.naturalHeight}`;
                preview.style.aspectRatio = ratio;
                preview.prepend(image);
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
              image.src = thumbnailUrl;
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
        stopEvent: (event) =>
          // `Node` here is Tiptap's, so reach for the DOM one explicitly.
          preview.contains(event.target as globalThis.Node | null) &&
          (event.type === "mousedown" ||
            event.type === "mouseup" ||
            event.type === "click"),
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
