import { useContext } from "react";
import { X } from "lucide-react";
import { toast, Toaster } from "react-hot-toast";
import { APP_SHELL_RAIL_OFFSET } from "@/lib/constants/appShellRail";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { MOBILE_TARGET } from "@/lib/configs/general.config";

export const SINGLE_UNDO_TOASTER_ID = "htpr-6885-undo";
export const undoToastSettings = { single: false };
let previousUndoToastId: string | undefined;

export const SingleUndoToaster = ({
  mobile,
  appShellRailOn,
}: {
  mobile: boolean;
  appShellRailOn: boolean;
}) => (
  <Toaster
    toasterId={SINGLE_UNDO_TOASTER_ID}
    position="bottom-left"
    containerStyle={{
      left: appShellRailOn ? APP_SHELL_RAIL_OFFSET : 16,
      bottom: mobile ? "calc(72px + env(safe-area-inset-bottom))" : 16,
    }}
  />
);

export const UNDO_ACTION_WINDOW_MS = 15_000;
export const UNDO_TOAST_DURATION_MS = UNDO_ACTION_WINDOW_MS;
export const MOBILE_UNDO_ACTION_WINDOW_MS = 7_500;
export const MOBILE_UNDO_TOAST_DURATION_MS = MOBILE_UNDO_ACTION_WINDOW_MS;

export const UndoToastContent = ({
  t,
  toastText,
  onUndo,
  singleUndoToast = false,
}: {
  t: { id: string; visible: boolean };
  toastText: string;
  onUndo: (toastId: string) => void;
  singleUndoToast?: boolean;
}) => {
  const isMbl = useContext(MobileViewContext);

  if (singleUndoToast) {
    return (
      <div
        className="flex min-h-10 max-w-full items-center gap-2 rounded-[5px] border-l-[3px] border-hypertasks-header-blue bg-modalBackground px-3 text-content font-normal text-white-black shadow-md"
        style={{ opacity: t.visible ? 1 : 0, transition: "opacity 200ms ease-in-out" }}
      >
        <span className="min-w-0 break-words">{toastText}</span>
        <button
          type="button"
          aria-label="Undo"
          className={`shrink-0 cursor-pointer font-normal text-text-light-gray hover:text-white-black hover:underline ${isMbl ? MOBILE_TARGET : ""}`}
          onClick={() => onUndo(t.id)}
        >
          Undo
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          className={`flex shrink-0 cursor-pointer items-center justify-center text-text-light-gray hover:text-white-black ${isMbl ? MOBILE_TARGET : ""}`}
          onClick={() => toast.dismiss(t.id, SINGLE_UNDO_TOASTER_ID)}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  const fade = {
    opacity: t.visible ? 1 : 0,
    transition: "opacity 150ms ease-in-out",
  } as const;

  if (isMbl) {
    const slide = {
      opacity: t.visible ? 1 : 0,
      transform: t.visible ? "translateX(0)" : "translateX(-16px)",
      transition: "opacity 150ms ease-in-out, transform 200ms ease-in-out",
    } as const;
    return (
      <div
        className="relative flex max-w-[110px] flex-col items-start gap-1 rounded-md bg-modalBackground px-2 py-1 shadow-lg"
        style={slide}
      >
        <div className="w-full pr-6">
          <span className="block min-w-0 text-[12px] leading-tight text-white-black">
            {toastText}
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            className={`${MOBILE_TARGET} absolute -right-3 -top-3 cursor-pointer rounded text-[12px] font-bold leading-none text-text-light-gray`}
            onClick={() => toast.dismiss(t.id)}
          >
            X
          </button>
        </div>
        <button
          type="button"
          aria-label="Undo"
          className="text-[12px] font-semibold leading-none text-hypertasks-header-blue"
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
  const singleUndoToast = undoToastSettings.single;
  const callback = async (toastId: string) => {
    await undoHandler(dataBeforeDeletion, toastId);
  };

  if (singleUndoToast && previousUndoToastId) toast.remove(previousUndoToastId, SINGLE_UNDO_TOASTER_ID);

  const toastHandler: any = toast.custom(
    (t) => (
      <UndoToastContent
        t={t}
        toastText={toastText}
        onUndo={callback}
        singleUndoToast={singleUndoToast}
      />
    ),
    singleUndoToast ? {
      toasterId: SINGLE_UNDO_TOASTER_ID,
      duration: 5000,
      removeDelay: 200,
      position: "bottom-left",
    } : {
      duration: isMobile
        ? MOBILE_UNDO_TOAST_DURATION_MS
        : UNDO_TOAST_DURATION_MS,
      position: isMobile ? "top-left" : "bottom-left",
    },
  );
  previousUndoToastId = toastHandler;
  return toastHandler;
};
