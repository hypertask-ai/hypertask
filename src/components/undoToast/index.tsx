import { useContext, useEffect } from "react";
import { X } from "lucide-react";
import { toast, Toaster, useToasterStore } from "react-hot-toast";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7657_ONE_TOAST_FLAG } from "@/lib/flags/keys";
import { toastIdsToDismiss } from "@/lib/toastIdsToDismiss";
import { APP_SHELL_RAIL_OFFSET } from "@/lib/constants/appShellRail";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { MOBILE_TARGET } from "@/lib/configs/general.config";

export const SINGLE_UNDO_TOASTER_ID = "htpr-6885-undo";
let previousUndoToastId: string | undefined;

export const SingleUndoToaster = ({
  mobile,
  appShellRailOn,
}: {
  mobile: boolean;
  appShellRailOn: boolean;
}) => {
  const oneToastAtATime = useFlag(HTPR_7657_ONE_TOAST_FLAG);
  return (
    <>
      <Toaster
        toasterId={SINGLE_UNDO_TOASTER_ID}
        position="bottom-left"
        containerStyle={{
          left: appShellRailOn ? APP_SHELL_RAIL_OFFSET : 16,
          bottom: mobile ? "calc(72px + env(safe-area-inset-bottom))" : 16,
        }}
      />
      {oneToastAtATime && <KeepOneToastVisible />}
    </>
  );
};

const KeepOneToastVisible = () => {
  const undoToasts = useToasterStore(undefined, SINGLE_UNDO_TOASTER_ID).toasts;
  const { toasts } = useToasterStore();
  const staleIds = JSON.stringify(toastIdsToDismiss(toasts, undoToasts));
  useEffect(() => {
    const stale = JSON.parse(staleIds) as ReturnType<typeof toastIdsToDismiss>;
    for (const id of stale.toasts) toast.dismiss(id);
    for (const id of stale.undoToasts) toast.dismiss(id, SINGLE_UNDO_TOASTER_ID);
  }, [staleIds]);
  return null;
};

export const UNDO_ACTION_WINDOW_MS = 15_000;
export const MOBILE_UNDO_ACTION_WINDOW_MS = 7_500;

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
};

export const UndoToaster = (
  toastText: string,
  dataBeforeDeletion: any,
  undoHandler: (data: any, toastId: string) => Promise<void>,
  isMobile: boolean,
) => {
  const callback = async (toastId: string) => {
    await undoHandler(dataBeforeDeletion, toastId);
  };

  if (previousUndoToastId) toast.remove(previousUndoToastId, SINGLE_UNDO_TOASTER_ID);

  const toastHandler: any = toast.custom(
    (t) => (
      <UndoToastContent
        t={t}
        toastText={toastText}
        onUndo={callback}
      />
    ),
    {
      toasterId: SINGLE_UNDO_TOASTER_ID,
      duration: 5000,
      removeDelay: 200,
      position: "bottom-left",
    },
  );
  previousUndoToastId = toastHandler;
  return toastHandler;
};
