"use client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import actions from "@/utils/undoActions";
import { UNDO_ACTION_WINDOW_MS, UndoToaster } from "@/components/undoToast";
import toast from "react-hot-toast";
import { canRunUndo, isUndoWindowExpired, UndoTrigger } from "./undoWindow";
import { MobileViewContext } from "@/lib/contexts/mobileContext";

type Mode =
  "UNDO_REMOVE" | "UNDO_INBOX_ARCHIVE" | "UNDO_STAR" | "UNDO_PIN" | "other";

interface UndoContextProps {
  data: any;
  performActionAndStoreUndoData: (
    actionData: any,
    undoText: string,
    undoHandler: any,
  ) => void;
  undoAction: (mode: Mode, actionData: any) => Promise<any> | void;
  undoLatest: () => Promise<boolean>;
  undoData: any[];
}

const UndoContext = createContext<UndoContextProps | undefined>(undefined);

const UndoProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const isMobile = useContext(MobileViewContext);
  const [data, setData] = useState<any>(null);
  // console.log("🚀 ~ data:", data)
  const [undoData, setRenderedUndoData] = useState<any[]>([]);
  // Keyboard events can arrive before React commits the state update that
  // follows an archive. The ref is authoritative; state is its render snapshot.
  const undoDataRef = useRef<any[]>([]);
  const consumedUndoIds = useRef(new Set<string>());
  const inFlightUndoIds = useRef(new Set<string>());
  const expiryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // console.log("🚀 ~ undoData:", undoData)

  const commitUndoData = useCallback((update: (items: any[]) => any[]) => {
    const nextItems = update(undoDataRef.current);
    undoDataRef.current = nextItems;
    setRenderedUndoData(nextItems);
  }, []);

  const performActionAndStoreUndoData = useCallback(
    (actionData: any, undoText: string, undoHandler: any) => {
      let pendingUndoData: any;
      const scheduleExpiry = (undoId: string, expiresAt: number) => {
        const existingTimer = expiryTimers.current.get(undoId);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(() => {
          expiryTimers.current.delete(undoId);
          // The request owns this entry until it settles. Its failure path
          // reissues a fresh shortcut window instead of losing retryability.
          if (inFlightUndoIds.current.has(undoId)) return;
          commitUndoData((items) =>
            items.filter((item) => String(item.toastId) !== undoId),
          );
        }, Math.max(0, expiresAt - Date.now()));
        expiryTimers.current.set(undoId, timer);
      };

      // `source` separates the two ways an undo is triggered. The visible UNDO
      // button on the toast is explicit intent and must work for as long as the
      // button is on screen: react-hot-toast pauses its 5s auto-dismiss while
      // the pointer hovers the toast, so the prompt routinely outlives the 15s
      // action window and the click was silently swallowed, leaving the task
      // archived with no error (HTPR-5528). The window still bounds the ambient
      // Ctrl+Z path, which has no visible affordance to reason about.
      const handleUndo = async (
        _actionData: any,
        toastId: string,
        source: UndoTrigger = "toast",
      ) => {
        const undoId = String(toastId);
        if (!canRunUndo(pendingUndoData, source, Date.now())) {
          const expiryTimer = expiryTimers.current.get(undoId);
          if (expiryTimer) clearTimeout(expiryTimer);
          expiryTimers.current.delete(undoId);
          commitUndoData((items) =>
            items.filter((item) => String(item.toastId) !== undoId),
          );
          toast.dismiss(toastId);
          return;
        }
        if (
          consumedUndoIds.current.has(undoId) ||
          inFlightUndoIds.current.has(undoId)
        ) {
          return;
        }

        // Mark in-flight synchronously so clicks and key auto-repeat cannot race.
        // Consume only after success so a transient failure remains retryable.
        inFlightUndoIds.current.add(undoId);
        try {
          await undoHandler(pendingUndoData, toastId);

          consumedUndoIds.current.add(undoId);
          const expiryTimer = expiryTimers.current.get(undoId);
          if (expiryTimer) clearTimeout(expiryTimer);
          commitUndoData((items) =>
            items.filter((item) => String(item.toastId) !== undoId),
          );
          const consumedCleanupTimer = setTimeout(() => {
            consumedUndoIds.current.delete(undoId);
            expiryTimers.current.delete(undoId);
          }, UNDO_ACTION_WINDOW_MS);
          expiryTimers.current.set(undoId, consumedCleanupTimer);
        } catch (error) {
          console.error("Undo action failed", error);
          toast.error("Undo failed. Please try again.");
          if (isUndoWindowExpired(pendingUndoData, Date.now())) {
            pendingUndoData = {
              ...pendingUndoData,
              expiresAt: Date.now() + UNDO_ACTION_WINDOW_MS,
            };
            commitUndoData((items) =>
              items.map((item) =>
                String(item.toastId) === undoId ? pendingUndoData : item,
              ),
            );
            scheduleExpiry(undoId, pendingUndoData.expiresAt);
          }
        } finally {
          inFlightUndoIds.current.delete(undoId);
        }
      };
      const toasterId = UndoToaster(
        undoText,
        actionData,
        handleUndo,
        isMobile,
      );
      const undoId = String(toasterId);
      pendingUndoData = {
        ...actionData,
        toastId: toasterId,
        undoHandler: handleUndo,
        expiresAt: Date.now() + UNDO_ACTION_WINDOW_MS,
      };
      // console.log("🚀 ~ performActionAndStoreUndoData ~ toasterId:", toasterId)
      setData(pendingUndoData);
      commitUndoData((prevUndoData) => [...prevUndoData, pendingUndoData]);
      scheduleExpiry(undoId, pendingUndoData.expiresAt);
    },
    [commitUndoData, isMobile],
  );

  const undoAction = useCallback(async (mode: Mode, actionData: any) => {
    setData(actionData);
    commitUndoData((prevUndoData) =>
      prevUndoData.filter((item) =>
        actionData?.toastId === undefined
          ? item !== actionData
          : String(item.toastId) !== String(actionData.toastId),
      ),
    );

    // Call the appropriate undo action based on the mode
    if (mode === "UNDO_REMOVE") {
      const response = await actions.undoTaskDelete(actionData);
      return response;
    } else if (mode === "UNDO_INBOX_ARCHIVE") {
      const response = actions.UndoInboxArchive(actionData);
      return response;
    } else if (mode === "UNDO_STAR") {
      const response = actions.UndoStar(actionData);
      return response;
    } else if (mode === "UNDO_PIN") {
      const response = actions.UndoPin(actionData);
      return response;
    } else if (mode === "other") {
      actions.undoTaskCreate(actionData);
    }
  }, [commitUndoData]);

  const undoLatest = useCallback(async () => {
    const pendingUndo = undoDataRef.current[undoDataRef.current.length - 1];
    if (
      !pendingUndo?.undoHandler ||
      isUndoWindowExpired(pendingUndo, Date.now()) ||
      consumedUndoIds.current.has(String(pendingUndo.toastId)) ||
      inFlightUndoIds.current.has(String(pendingUndo.toastId))
    ) {
      return false;
    }

    await pendingUndo.undoHandler(pendingUndo, pendingUndo.toastId, "shortcut");
    return true;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (!event.ctrlKey && !event.metaKey) ||
        event.shiftKey ||
        event.key.toLowerCase() !== "z"
      ) {
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const inTextEditor =
        Boolean(active) &&
        (active!.tagName === "INPUT" ||
          active!.tagName === "TEXTAREA" ||
          active!.isContentEditable);
      if (inTextEditor) return;

      // No early return on an empty stack: the expiry timer drops the entry the
      // moment the window closes, so bailing here is exactly the case that has
      // to speak. Outside a text field there is nothing native to fall through
      // to anyway.
      event.preventDefault();
      event.stopImmediatePropagation();
      // Say so when the window has already closed. Silently doing nothing reads
      // as "undo is broken" (HTPR-5569); the palette entry already says this.
      void undoLatest().then((didUndo) => {
        if (!didUndo) toast("Nothing to undo");
      });
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [undoLatest]);

  useEffect(
    () => () => {
      expiryTimers.current.forEach((timer) => clearTimeout(timer));
      expiryTimers.current.clear();
      undoDataRef.current = [];
      consumedUndoIds.current.clear();
      inFlightUndoIds.current.clear();
    },
    [],
  );

  const value: UndoContextProps = useMemo(
    () => ({
      data,
      performActionAndStoreUndoData,
      undoAction,
      undoLatest,
      undoData,
    }),
    [data, performActionAndStoreUndoData, undoAction, undoLatest, undoData],
  );

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>;
};

const useUndoContext = () => {
  const context = useContext(UndoContext);
  if (!context) {
    throw new Error("useUndoContext must be used within an UndoProvider");
  }
  return context;
};

export { UndoProvider, useUndoContext };
