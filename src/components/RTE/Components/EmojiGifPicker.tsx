import { LazyEmojiPickerRaw, preloadEmojiResources } from "@/utils/emojiLoader";
import type { Editor } from "@tiptap/react";
import { Search } from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

export const OPEN_EMOJI_GIF_PICKER_EVENT = "tiptap-open-emoji-gif-picker";

export type EmojiGifPickerTab = "emoji" | "gifs";

export interface EmojiGifPickerEventDetail {
  editor: Editor;
  initialTab: EmojiGifPickerTab;
  position: number;
  anchorRect: Pick<DOMRect, "bottom" | "left" | "top">;
}

interface GiphyRendition {
  height?: string;
  url?: string;
  webp?: string;
  width?: string;
}

interface GiphyGif {
  id: string;
  images: {
    downsized_medium?: GiphyRendition;
    fixed_width?: GiphyRendition;
    original?: GiphyRendition;
  };
  title: string;
}

interface EmojiGifPickerProps {
  anchorRect: EmojiGifPickerEventDetail["anchorRect"];
  editor: Editor;
  initialTab: EmojiGifPickerTab;
  insertPosition: number;
  onClose: () => void;
}

const EmojiGifPicker = ({
  anchorRect,
  editor,
  initialTab,
  insertPosition,
  onClose,
}: EmojiGifPickerProps) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const gifButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeTab, setActiveTab] = useState<EmojiGifPickerTab>(initialTab);
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const GIF_COLUMNS = 3;
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const portalRoot =
    typeof document === "undefined" ? null : document.getElementById("portal-root");

  const updatePosition = useCallback(() => {
    const popoverWidth = popoverRef.current?.offsetWidth ?? 360;
    const popoverHeight = popoverRef.current?.offsetHeight ?? 430;
    const viewportPadding = 8;
    const left = Math.max(
      viewportPadding,
      Math.min(anchorRect.left, window.innerWidth - popoverWidth - viewportPadding)
    );
    const topAbove = anchorRect.top - popoverHeight - viewportPadding;
    const topBelow = anchorRect.bottom + viewportPadding;
    const preferredTop =
      topAbove >= viewportPadding
        ? topAbove
        : Math.min(topBelow, window.innerHeight - popoverHeight - viewportPadding);

    setPosition({
      left,
      top: Math.max(viewportPadding, preferredTop),
    });
  }, [anchorRect]);

  useLayoutEffect(() => {
    updatePosition();

    const resizeObserver = new ResizeObserver(updatePosition);
    if (popoverRef.current) resizeObserver.observe(popoverRef.current);

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [updatePosition]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      // Tab toggles Emoji|GIF. Handled here in the capture phase (not on the
      // popover's onKeyDown) so it fires before emoji-mart's own input can
      // swallow the keypress, keeping the switch symmetric from both tabs.
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        setActiveTab((tab) => (tab === "emoji" ? "gifs" : "emoji"));
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  useEffect(() => {
    if (activeTab === "emoji") preloadEmojiResources();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "gifs") return;

    const apiKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY;
    if (!apiKey) {
      setGifs([]);
      setError("GIF search is unavailable.");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setError("");
    setIsLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const trimmedQuery = query.trim();
        const endpoint = trimmedQuery ? "search" : "trending";
        const params = new URLSearchParams({
          api_key: apiKey,
          limit: "24",
          rating: "pg-13",
        });
        if (trimmedQuery) params.set("q", trimmedQuery);

        const response = await fetch(
          `https://api.giphy.com/v1/gifs/${endpoint}?${params.toString()}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("Giphy request failed");

        const result = (await response.json()) as { data?: GiphyGif[] };
        setGifs(Array.isArray(result.data) ? result.data : []);
      } catch (fetchError) {
        if ((fetchError as Error).name === "AbortError") return;
        setGifs([]);
        setError("Could not load GIFs. Try again.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, query]);

  // Only GIFs with a thumbnail can render, so index/navigate/insert against
  // this filtered list to keep the keyboard highlight in sync with the grid.
  const renderableGifs = useMemo(
    () =>
      gifs.filter(
        (gif) => gif.images.fixed_width?.webp ?? gif.images.fixed_width?.url
      ),
    [gifs]
  );

  // Reset the keyboard highlight whenever the result set changes.
  useEffect(() => {
    setHighlightedIndex(0);
  }, [renderableGifs]);

  // Keep the highlighted cell visible as arrows move through the grid.
  useEffect(() => {
    gifButtonRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const handleGifSearchKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>
  ) => {
    // While a new query is loading the grid is hidden but `renderableGifs`
    // still holds the previous results, so ignore keys to avoid a stale insert.
    if (isLoading || renderableGifs.length === 0) return;

    const move = (delta: number) => {
      event.preventDefault();
      setHighlightedIndex((current) => {
        const next = current + delta;
        if (next < 0 || next >= renderableGifs.length) return current;
        return next;
      });
    };

    // Left/Right only navigate the grid when the caret sits at the matching
    // edge of the query, so mid-string typo fixes still move the text cursor.
    const caret = event.currentTarget.selectionStart ?? 0;
    const caretEnd = event.currentTarget.selectionEnd ?? 0;
    const hasSelection = caret !== caretEnd;
    const atStart = !hasSelection && caret === 0;
    const atEnd = !hasSelection && caret === query.length;

    switch (event.key) {
      case "ArrowRight":
        return atEnd ? move(1) : undefined;
      case "ArrowLeft":
        return atStart ? move(-1) : undefined;
      case "ArrowDown":
        return move(GIF_COLUMNS);
      case "ArrowUp":
        return move(-GIF_COLUMNS);
      case "Enter": {
        const gif = renderableGifs[highlightedIndex];
        if (gif) {
          event.preventDefault();
          selectGif(gif);
        }
        return;
      }
      default:
        return;
    }
  };

  const selectEmoji = (emoji: { native?: string }) => {
    if (!emoji.native) return;
    editor
      .chain()
      .focus()
      .setTextSelection(insertPosition)
      .insertContent(emoji.native)
      .run();
    onClose();
  };

  const selectGif = (gif: GiphyGif) => {
    const source = gif.images.downsized_medium?.url ?? gif.images.original?.url;
    if (!source) return;

    editor
      .chain()
      .focus()
      .setTextSelection(insertPosition)
      .setMedia({
        "media-type": "img",
        src: source,
        alt: gif.title || "GIF",
        title: gif.title || "GIF",
      })
      .run();
    onClose();
  };

  if (!portalRoot) return null;

  const isDark = document.documentElement.classList.contains("dark");

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Insert emoji or GIF"
      className="fixed z-[10000] flex h-[430px] max-h-[calc(100vh-16px)] w-[360px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md bg-modalBackground text-white-black shadow-xl"
      style={position}
    >
      <div
        role="tablist"
        aria-label="Media type"
        className="flex h-10 shrink-0 border-b border-border-light-gray-thin px-2"
      >
        {(["emoji", "gifs"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`relative px-3 text-content font-medium transition-colors ${
              activeTab === tab
                ? "text-white-black after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-hypertasks-purple"
                : "text-text-light-gray hover:text-white-black"
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "emoji" ? "Emoji" : "GIFs"}
          </button>
        ))}
      </div>

      {activeTab === "emoji" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-content text-text-light-gray">
                Loading emoji…
              </div>
            }
          >
            <LazyEmojiPickerRaw
              autoFocus={true}
              emojiSize={20}
              enableFrequentEmojiSort={true}
              height="100%"
              onEmojiSelect={selectEmoji}
              perLine={8}
              previewPosition="none"
              showCloseButton={false}
              showPreview={false}
              skinTonePosition="none"
              theme={isDark ? "dark" : "light"}
              width="100%"
            />
          </Suspense>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Borderless input over a bottom divider, same as the Ctrl+K palette */}
          <label className="flex shrink-0 items-center gap-2.5 border-b border-light-black-border-1 px-3">
            <span className="sr-only">Search GIFs</span>
            <Search
              aria-hidden="true"
              className="shrink-0 text-text-light-gray"
              size={15}
              strokeWidth={1.75}
            />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleGifSearchKeyDown}
              placeholder="Search GIPHY"
              role="combobox"
              aria-expanded={renderableGifs.length > 0}
              aria-controls="gif-results-listbox"
              aria-activedescendant={
                renderableGifs.length > 0 ? `gif-option-${highlightedIndex}` : undefined
              }
              className="h-9 w-full bg-transparent text-content text-white-black outline-none placeholder:text-text-light-gray"
            />
          </label>

          <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-1">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-content text-text-light-gray">
                Loading GIFs…
              </div>
            ) : error ? (
              <p className="p-2 text-content text-text-light-gray">{error}</p>
            ) : renderableGifs.length === 0 ? (
              <p className="p-2 text-content text-text-light-gray">No GIFs found.</p>
            ) : (
              <div
                id="gif-results-listbox"
                role="listbox"
                aria-label="GIF results"
                className="grid grid-cols-3 gap-1.5"
              >
                {renderableGifs.map((gif, index) => {
                  const thumbnail =
                    gif.images.fixed_width?.webp ?? gif.images.fixed_width?.url;

                  const isHighlighted = index === highlightedIndex;

                  return (
                    <button
                      key={gif.id}
                      id={`gif-option-${index}`}
                      ref={(node) => {
                        gifButtonRefs.current[index] = node;
                      }}
                      type="button"
                      role="option"
                      aria-label={`Insert ${gif.title || "GIF"}`}
                      aria-selected={isHighlighted}
                      title={gif.title || "GIF"}
                      className={`h-24 overflow-hidden rounded-[4px] bg-cardBackground focus:outline-none ${
                        isHighlighted ? "ring-2 ring-hypertasks-purple" : ""
                      }`}
                      onClick={() => selectGif(gif)}
                    >
                      {/* Giphy thumbnails are remote animated assets, so Next Image is not applicable here. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbnail}
                        alt={gif.title || "GIF"}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="shrink-0 px-2 py-1.5 text-right text-[10px] font-medium tracking-wide text-text-light-gray">
            Powered by GIPHY
          </div>
        </div>
      )}
    </div>,
    portalRoot
  );
};

export default EmojiGifPicker;
