import { useContext } from "react";
import { toast } from "react-hot-toast";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { MOBILE_TARGET } from "@/lib/configs/general.config";

export const UNDO_ACTION_WINDOW_MS = 15_000;
// The toast is the only visible way to undo an archive, so it must stay on
// screen for as long as the undo is actually available. #2668 cut the prompt
// to 5s while the action window stayed at 15s, which left a dead zone: from
// 5s the toast is removed from the DOM, so the UNDO button no longer exists
// and the archive can only be reversed by Ctrl+Z, which most people never
// try. Verified live on production for HTPR-5543: clicking UNDO 1.2s after
// archiving restores the task, at 7s there is no button left to click and the
// task stays archived. Keep the two timings in lockstep.
export const UNDO_TOAST_DURATION_MS = UNDO_ACTION_WINDOW_MS;

/**
 * Rendered inside the <Toaster> tree, so it can read MobileViewContext.
 *
 * Mobile (HTPR-5564, per the approved wireframe): the same narrow dark pill,
 * now with the desktop Dismiss X, anchored to the LEFT edge just below
 * vertical center (top edge ~52% of screen height — set by
 * `.toastContainerMobile { top: 52% }`; the left anchor comes from this
 * toast's own `position: "top-left"`, so ordinary mobile toasts stay on the
 * right). That keeps the task actions clear and stays out of the bottom thumb
 * zone. Undo keeps its full 15s window; timing is unchanged.
 * Desktop keeps the existing white toast with an explicit X.
 */
export const UndoToastContent = ({
  t,
  toastText,
  onUndo,
}: {
  t: { id: string; visible: boolean };
  toastText: string;
  onUndo: (toastId: string) => void;
}) => {
  const isMbl = useContext(MobileViewContext);

  const fade = {
    opacity: t.visible ? 1 : 0,
    transition: "opacity 150ms ease-in-out",
  } as const;

  if (isMbl) {
    // Anchored to the left edge by this toast's own position; slide back
    // toward that edge on exit.
    const slide = {
      opacity: t.visible ? 1 : 0,
      transform: t.visible ? "translateX(0)" : "translateX(-16px)",
      transition: "opacity 150ms ease-in-out, transform 200ms ease-in-out",
    } as const;
    return (
      <div
        className="flex max-w-[150px] flex-col items-start gap-1.5 rounded-md bg-modalBackground px-3.5 py-2.5 shadow-lg"
        style={slide}
      >
        <div className="flex w-full items-start gap-1.5">
          <span className="min-w-0 flex-1 text-[13px] leading-snug text-white-black">
            {toastText}
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            // 44px touch target per the glyph-only rule (HTPR-5098); the
            // negative margins keep the oversized target from growing the
            // pill beyond its wireframe footprint.
            className={`${MOBILE_TARGET} -my-3 cursor-pointer rounded text-[13px] font-bold leading-none text-text-light-gray`}
            onClick={() => toast.dismiss(t.id)}
          >
            X
          </button>
        </div>
        <button
          type="button"
          aria-label="Undo"
          className="text-[13px] font-semibold leading-none text-hypertasks-header-blue"
          onClick={() => onUndo(t.id)}
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <div
      className="bg-white xs:text-content sm:text-emphasis rounded-md px-2 py-1 border-l-[6px] border-blue-500 items-center flex flex-row w-fit gap-3"
      style={fade}
    >
      <div className="pl-1 pr-3 text-black">{toastText}</div>
      {/* Real buttons, not clickable divs: the label already reads "Undo task
          archive", so anything targeting the toast by its accessible name (a
          screen reader, the keyboard, an agent driving the app) landed on the
          inert label and the archive was never reversed (HTPR-5569). */}
      <button
        type="button"
        aria-label="Undo"
        className="text-[#4455BB] font-bold cursor-pointer"
        onClick={() => onUndo(t.id)}
      >
        UNDO
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        className="text-gray-600 cursor-pointer font-bold text-dense px-1"
        onClick={() => toast.dismiss(t.id)}
      >
        X
      </button>
    </div>
  );
};

export const UndoToaster = (
  toastText: string,
  dataBeforeDeletion: any,
  undoHandler: (data: any, toastId: string) => Promise<void>,
  isMobile: boolean,
) => {
  const callback = async (toastId: string) => {
    // toast.dismiss(toastId)
    await undoHandler(dataBeforeDeletion, toastId);
    //  first you need to bring the item back in its place.
    // then you need to run the api call so there is no render blocking.
  };

  const toastHandler: any = toast.custom(
    (t) => <UndoToastContent t={t} toastText={toastText} onUndo={callback} />,
    {
      // Matches the undo action window: the prompt never disappears while the
      // action behind it can still be undone.
      duration: UNDO_TOAST_DURATION_MS,
      // Mobile anchors left so the task actions on the right stay clear
      // (HTPR-5564 wireframe); react-hot-toast aligns each toast row on its
      // own side of the shared `.toastContainerMobile` wrapper. The position
      // is captured at creation, like the desktop/desktop-content split always
      // was: rotating across the breakpoint mid-window changes only which side
      // the pill hugs for its remaining seconds.
      position: isMobile ? "top-left" : "bottom-left",
    },
  );
  return toastHandler;
};
