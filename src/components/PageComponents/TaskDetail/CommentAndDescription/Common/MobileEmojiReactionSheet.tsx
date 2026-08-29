import { LazyEmojiPickerRaw } from "@/utils/emojiLoader";
import { Suspense, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface MobileEmojiReactionSheetProps {
  /** Applies the reaction. Also closes the picker via its own state update. */
  onEmojiSelect: (emoji: any, event?: any) => void;
  /** Dismiss without picking (backdrop tap / Escape). */
  onClose: () => void;
}

/**
 * Keyboard-docked, search-first reaction picker for mobile (WhatsApp/Slack
 * pattern, HTPR-4589). Replaces the old floating popup that could not raise the
 * keyboard, so type-to-search was dead. This is a full-width bottom sheet with
 * emoji-mart's search front-and-centre: type a name, results filter live, and
 * Enter inserts the top match; category tabs + the "Frequent" recents row come
 * from emoji-mart itself.
 *
 * `interactive-widget=resizes-content` (see generateViewport in app/layout.tsx)
 * shrinks the layout viewport while the keyboard is up, so `fixed bottom-0`
 * rests directly on top of the keyboard.
 */
const MobileEmojiReactionSheet = ({
  onEmojiSelect,
  onClose,
}: MobileEmojiReactionSheetProps) => {
  const hostRef = useRef<HTMLDivElement>(null);

  const portalRoot =
    typeof document === "undefined"
      ? null
      : document.getElementById("portal-root");

  // Close on Escape (hardware keyboard / a11y). Pointer dismissal is the
  // backdrop; capture phase so it wins before emoji-mart's own key handling.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  // Show a blinking caret in the search field WITHOUT auto-opening the on-screen
  // keyboard (it covered the sheet and felt jarring). emoji-mart's search lives
  // in an open shadow root; once it mounts we set inputmode="none" (focused but
  // no virtual keyboard) and focus it. Tapping the field switches inputmode back
  // and re-focuses within the gesture, so the keyboard opens on demand for
  // type-to-search.
  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    let input: HTMLInputElement | null = null;

    const enableTyping = () => {
      if (!input) return;
      input.inputMode = "search";
      // A fresh focus inside the tap gesture is what raises the keyboard.
      input.blur();
      input.focus();
      input.removeEventListener("pointerdown", enableTyping);
    };

    const setup = () => {
      const host = hostRef.current?.querySelector("em-emoji-picker") as
        | (HTMLElement & { shadowRoot?: ShadowRoot | null })
        | null;
      input = host?.shadowRoot?.querySelector("input") ?? null;
      if (input) {
        input.inputMode = "none";
        input.focus();
        input.addEventListener("pointerdown", enableTyping);
        return;
      }
      if (attempts++ < 40) frame = window.requestAnimationFrame(setup);
    };

    frame = window.requestAnimationFrame(setup);
    return () => {
      window.cancelAnimationFrame(frame);
      input?.removeEventListener("pointerdown", enableTyping);
    };
  }, []);

  if (!portalRoot) return null;

  return createPortal(
    <>
      {/* Dim the feed behind the sheet and swallow background taps/scroll. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[9998] bg-black/40"
        onPointerDown={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add reaction"
        className="reaction-emoji-sheet fixed inset-x-0 bottom-0 z-[9999] flex max-h-[85vh] w-full flex-col overflow-hidden overscroll-contain rounded-t-[12px] bg-modalBackground text-white-black shadow-[0_-8px_24px_rgba(0,0,0,0.35)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex h-6 shrink-0 items-center justify-center">
          <span className="h-1 w-9 rounded-full bg-[#4F5766]" />
        </div>
        <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden overscroll-contain">
          <Suspense
            fallback={
              <div className="flex h-[250px] items-center justify-center text-content text-text-light-gray">
                Loading emoji…
              </div>
            }
          >
            {/* Theme is resolved by the LazyEmojiPickerRaw wrapper. autoFocus
                is off — the effect above focuses without raising the keyboard. */}
            <LazyEmojiPickerRaw
              autoFocus={false}
              dynamicWidth={true}
              emojiSize={24}
              enableFrequentEmojiSort={true}
              navPosition="top"
              onEmojiSelect={onEmojiSelect}
              perLine={9}
              previewPosition="none"
              searchPosition="sticky"
              skinTonePosition="none"
            />
          </Suspense>
        </div>
      </div>
    </>,
    portalRoot
  );
};

export default MobileEmojiReactionSheet;
