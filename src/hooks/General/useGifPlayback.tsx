import axios from "axios";
import { Pause, Play } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  USER_PREFERENCES_QUERY_KEY,
  useGetUserPreferences,
  type IUserPreferences,
} from "./useGetUserPreferences";

interface GifControlPosition {
  left: number;
  top: number;
}

interface GifMedia {
  element: HTMLElement;
  image: HTMLImageElement;
}

const isGifImage = (image: HTMLImageElement) => {
  try {
    const source = image.currentSrc || image.src;
    if (!source) return false;

    const url = new URL(source, window.location.href);
    return (
      url.hostname.toLowerCase().endsWith("giphy.com") ||
      url.pathname.toLowerCase().endsWith(".gif")
    );
  } catch {
    return false;
  }
};

export const useGifPlayback = (
  containerRef: RefObject<HTMLElement | null>,
  renderedHtml: string | undefined,
) => {
  const queryClient = useQueryClient();
  const { data: preferences } = useGetUserPreferences();
  const playGifs = preferences.playGifs ?? true;
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const updateIdRef = useRef(0);
  const [controlPosition, setControlPosition] =
    useState<GifControlPosition | null>(null);

  const setPlayGifs = useCallback(
    (nextPlayGifs: boolean) => {
      const updateId = ++updateIdRef.current;
      const previous = queryClient.getQueryData<IUserPreferences>(
        USER_PREFERENCES_QUERY_KEY,
      );

      void queryClient.cancelQueries(
        { queryKey: USER_PREFERENCES_QUERY_KEY },
        { revert: false },
      );
      queryClient.setQueryData<IUserPreferences>(
        USER_PREFERENCES_QUERY_KEY,
        (current) => ({
          ...(current ?? preferencesRef.current),
          playGifs: nextPlayGifs,
        }),
      );

      void axios
        .post("/api/users/preferences", { playGifs: nextPlayGifs })
        .then((response) => {
          if (
            updateId === updateIdRef.current &&
            response.status === 200 &&
            response.data.settings
          ) {
            queryClient.setQueryData<IUserPreferences>(
              USER_PREFERENCES_QUERY_KEY,
              (current) => ({
                ...(current ?? preferencesRef.current),
                ...response.data.settings,
              }),
            );
          }
        })
        .catch((error) => {
          if (updateId === updateIdRef.current && previous) {
            queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, previous);
          }
          console.log("useGifPlayback update error:", error);
        });
    },
    [queryClient],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const frames = new Map<HTMLImageElement, HTMLElement>();
    const frameImages = new WeakMap<HTMLElement, HTMLImageElement>();
    const originalDisplays = new WeakMap<HTMLImageElement, string>();
    const loadListeners = new Map<HTMLImageElement, () => void>();

    const showControl = (media: GifMedia) => {
      const mediaRect = media.element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      setControlPosition({
        left: Math.max(
          4,
          mediaRect.right - containerRect.left + container.scrollLeft - 28,
        ),
        top: Math.max(
          4,
          mediaRect.top - containerRect.top + container.scrollTop + 4,
        ),
      });
    };

    const unfreezeImage = (image: HTMLImageElement) => {
      const frame = frames.get(image);
      if (!frame) return;

      frame.remove();
      frames.delete(image);
      image.style.display = originalDisplays.get(image) ?? "";
    };

    const freezeImage = (image: HTMLImageElement) => {
      if (frames.has(image) || !image.isConnected) return;

      const imageRect = image.getBoundingClientRect();
      if (imageRect.width <= 0 || imageRect.height <= 0) return;

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return;

      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(imageRect.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(imageRect.height * pixelRatio));
      canvas.className = image.className;
      canvas.style.cssText = image.style.cssText;
      canvas.style.width = `${imageRect.width}px`;
      canvas.style.height = `${imageRect.height}px`;
      canvas.style.margin = "0";
      canvas.style.maxWidth = "none";
      canvas.style.display = "block";
      canvas.style.cursor = "pointer";
      canvas.setAttribute("aria-label", `${image.alt || "GIF"} paused`);

      try {
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.drawImage(image, 0, 0, imageRect.width, imageRect.height);
      } catch {
        return;
      }

      const computedStyle = window.getComputedStyle(image);
      const frame = document.createElement("span");
      frame.dataset.gifFrozenFrame = "true";
      frame.style.position = "relative";
      frame.style.display =
        computedStyle.display === "inline" ? "inline-block" : computedStyle.display;
      frame.style.width = `${imageRect.width}px`;
      frame.style.height = `${imageRect.height}px`;
      frame.style.maxWidth = "100%";
      frame.style.marginTop = computedStyle.marginTop;
      frame.style.marginRight = computedStyle.marginRight;
      frame.style.marginBottom = computedStyle.marginBottom;
      frame.style.marginLeft = computedStyle.marginLeft;
      frame.style.verticalAlign = computedStyle.verticalAlign;
      frame.style.cursor = "pointer";

      const badge = document.createElement("span");
      badge.textContent = "GIF";
      badge.style.position = "absolute";
      badge.style.bottom = "4px";
      badge.style.left = "4px";
      badge.style.padding = "1px 4px";
      badge.style.borderRadius = "4px";
      badge.style.background = "rgba(0, 0, 0, 0.65)";
      badge.style.color = "white";
      badge.style.fontSize = "10px";
      badge.style.fontWeight = "600";
      badge.style.lineHeight = "14px";
      badge.style.pointerEvents = "none";

      frame.append(canvas, badge);
      image.after(frame);
      originalDisplays.set(image, image.style.display);
      image.style.display = "none";
      frames.set(image, frame);
      frameImages.set(frame, image);
    };

    const getGifMedia = (target: EventTarget | null): GifMedia | null => {
      if (!(target instanceof Element)) return null;

      const frame = target.closest<HTMLElement>("[data-gif-frozen-frame]");
      if (frame && container.contains(frame)) {
        const image = frameImages.get(frame);
        return image ? { element: frame, image } : null;
      }

      const image = target.closest("img") as HTMLImageElement | null;
      if (!image || !container.contains(image) || !isGifImage(image)) return null;
      return { element: image, image };
    };

    const handleMouseOver = (event: MouseEvent) => {
      const media = getGifMedia(event.target);
      if (media) showControl(media);
    };

    const handleMouseOut = (event: MouseEvent) => {
      const control = container.querySelector<HTMLElement>(
        "[data-gif-playback-control]",
      );
      if (control?.contains(event.relatedTarget as Node)) return;

      const fromMedia = getGifMedia(event.target);
      const toMedia = getGifMedia(event.relatedTarget);
      const fromControl =
        event.target instanceof Element
          ? event.target.closest("[data-gif-playback-control]")
          : null;
      if (fromMedia && toMedia?.image === fromMedia.image) return;

      if (fromControl && toMedia) return;

      if (fromMedia || fromControl) setControlPosition(null);
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (target.closest("[data-gif-playback-control]")) {
        event.preventDefault();
        event.stopPropagation();
        setPlayGifs(!playGifs);
        return;
      }

      const media = getGifMedia(target);
      if (!media || playGifs) return;

      event.preventDefault();
      event.stopPropagation();

      if (frames.has(media.image)) {
        unfreezeImage(media.image);
        showControl({ element: media.image, image: media.image });
      } else {
        freezeImage(media.image);
        const frame = frames.get(media.image);
        if (frame) showControl({ element: frame, image: media.image });
      }
    };

    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseout", handleMouseOut);
    container.addEventListener("click", handleClick);

    const images = Array.from(container.querySelectorAll("img")).filter(
      isGifImage,
    );

    if (!playGifs) {
      images.forEach((image) => {
        if (image.dataset.gifPlaybackProcessed) return;
        image.dataset.gifPlaybackProcessed = "true";

        if (image.complete && image.naturalWidth > 0) {
          freezeImage(image);
          return;
        }

        const handleLoad = () => freezeImage(image);
        loadListeners.set(image, handleLoad);
        image.addEventListener("load", handleLoad, { once: true });
      });
    }

    return () => {
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseout", handleMouseOut);
      container.removeEventListener("click", handleClick);
      loadListeners.forEach((listener, image) =>
        image.removeEventListener("load", listener),
      );
      images.forEach((image) => {
        unfreezeImage(image);
        delete image.dataset.gifPlaybackProcessed;
      });
      setControlPosition(null);
    };
  }, [containerRef, playGifs, renderedHtml, setPlayGifs]);

  const controlLabel = playGifs ? "Stop playing GIFs" : "Play GIFs";

  return {
    control:
      controlPosition && containerRef.current
        ? createPortal(
            <button
              type="button"
              data-gif-playback-control="true"
              aria-label={controlLabel}
              title={controlLabel}
              className="absolute z-30 flex h-6 w-6 items-center justify-center rounded-[4px] border-0 bg-containerBackground text-white-black shadow-md hover:bg-hover-active focus:outline-none focus-visible:bg-hover-active"
              style={controlPosition}
            >
              {playGifs ? <Pause size={14} /> : <Play size={14} />}
            </button>,
            containerRef.current,
          )
        : null,
  };
};
