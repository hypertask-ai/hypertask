"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type TouchEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import toast from "react-hot-toast";

import {
  INBOX_QUERY_KEY,
  useGetNotifications,
} from "@/hooks/Inbox/useGetNotifications";
import useGlobalFocusHandler from "@/hooks/Inbox/useGlobalFocusHandler";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import type { INotification } from "@/models/model";
import { cn } from "@/utils/undoActions/helperFuncs";
import EmbeddedTaskDetail from "./EmbeddedTaskDetail";

type Decision = {
  notificationId: string;
  action: "archive" | "keep";
};

type SwipeUnreadProps = {
  userId: number;
  onClose: () => void;
};

const SWIPE_DURATION_MS = 180;
const CAUGHT_UP_DURATION_MS = 850;
const SWIPE_START_THRESHOLD_PX = 16;

const isEditorElement = (element: EventTarget | null) =>
  element instanceof Element &&
  Boolean(element.closest('input, textarea, [contenteditable="true"]'));

const SwipeUnread = ({ userId, onClose }: SwipeUnreadProps) => {
  const isMobile = useContext(MobileViewContext);
  const queryClient = useQueryClient();
  const { bulkArchiveHandler } = useGlobalFocusHandler();
  const { data: inbox, isError, isFetching } = useGetNotifications(userId);
  const [notifications, setNotifications] = useState<INotification[] | null>(
    null
  );
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const decisionsRef = useRef<Decision[]>([]);
  const [dragX, setDragX] = useState(0);
  const dragXRef = useRef(0);
  const [transitioning, setTransitioning] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const animatingRef = useRef(false);
  const pendingDecisionRef = useRef<Decision | null>(null);
  const touchStartRef = useRef<{
    x: number;
    y: number;
    swiping: boolean;
  } | null>(null);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const taskScrollRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef(notifications);
  const bulkArchiveHandlerRef = useRef(bulkArchiveHandler);
  notificationsRef.current = notifications;
  bulkArchiveHandlerRef.current = bulkArchiveHandler;

  useEffect(() => {
    if (
      notifications !== null ||
      isFetching ||
      (isError && inbox.notifications.length === 0)
    ) {
      return;
    }
    // Match the inbox's unread count exactly: an unread notification is !seen.
    setNotifications(
      inbox.notifications.filter((notification) => !notification.seen)
    );
  }, [inbox.notifications, isError, isFetching, notifications]);

  const current = notifications?.[index];
  const currentTaskId = current?.taskId ?? null;
  const currentProjectId = current?.task?.projectId ?? current?.projectId;
  const currentUniqueIndex = current?.task?.uniqueIndex;

  const finish = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    if (animationTimerRef.current) {
      clearTimeout(animationTimerRef.current);
      animationTimerRef.current = null;
    }

    const decisionsToFlush = pendingDecisionRef.current
      ? [...decisionsRef.current, pendingDecisionRef.current]
      : decisionsRef.current;
    pendingDecisionRef.current = null;
    const markedRead = decisionsToFlush.filter(
      (decision) => decision.action === "archive"
    );

    try {
      if (markedRead.length > 0 && notifications) {
        // ponytail: defer all writes until exit so local Undo never needs an API reversal.
        await bulkArchiveHandler(
          markedRead.map((decision) => {
            const notification = notifications.find(
              (item) => item.id === decision.notificationId
            );
            return {
              taskId: notification?.taskId ?? null,
              userId,
              notificationId: Number.parseInt(decision.notificationId),
            };
          }),
          "Notification"
        );
        await queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
      }
    } catch {
      toast.error("Unable to archive the reviewed notifications");
    } finally {
      onClose();
    }
  }, [bulkArchiveHandler, notifications, onClose, queryClient, userId]);

  const decide = useCallback(
    (action: Decision["action"]) => {
      if (!current) return;
      const nextDecisions = [
        ...decisionsRef.current,
        { notificationId: current.id, action },
      ];
      decisionsRef.current = nextDecisions;
      setDecisions(nextDecisions);
      setIndex((currentIndex) => currentIndex + 1);
    },
    [current]
  );

  const animateDecision = useCallback(
    (action: Decision["action"]) => {
      if (!current || animatingRef.current || closingRef.current) return;
      animatingRef.current = true;
      pendingDecisionRef.current = {
        notificationId: current.id,
        action,
      };
      setTransitioning(true);
      setDragX(
        action === "archive"
          ? window.innerWidth * 1.15
          : window.innerWidth * -1.15
      );
      animationTimerRef.current = setTimeout(() => {
        decide(action);
        pendingDecisionRef.current = null;
        setTransitioning(false);
        setDragX(0);
        animatingRef.current = false;
        animationTimerRef.current = null;
      }, SWIPE_DURATION_MS);
    },
    [current, decide]
  );

  const undo = useCallback(() => {
    if (
      decisionsRef.current.length === 0 ||
      animatingRef.current ||
      closingRef.current
    ) {
      return;
    }
    const nextDecisions = decisionsRef.current.slice(0, -1);
    decisionsRef.current = nextDecisions;
    setDecisions(nextDecisions);
    setIndex((currentIndex) => Math.max(0, currentIndex - 1));
    setDragX(0);
  }, []);

  useEffect(() => {
    overlayRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
      if (closingRef.current) return;

      const notificationsToFlush = notificationsRef.current;
      const decisionsToFlush = pendingDecisionRef.current
        ? [...decisionsRef.current, pendingDecisionRef.current]
        : decisionsRef.current;
      const markedRead = decisionsToFlush.filter(
        (decision) => decision.action === "archive"
      );
      if (markedRead.length === 0 || !notificationsToFlush) return;

      void bulkArchiveHandlerRef.current(
        markedRead.map((decision) => {
          const notification = notificationsToFlush.find(
            (item) => item.id === decision.notificationId
          );
          return {
            taskId: notification?.taskId ?? null,
            userId,
            notificationId: Number.parseInt(decision.notificationId),
          };
        }),
        "Notification"
      )
        .then(() => queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY }))
        .catch(() => {});
    };
  }, [queryClient, userId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const editorFocused = isEditorElement(activeElement);

      if (event.key === "Escape" && editorFocused) {
        event.preventDefault();
        event.stopImmediatePropagation();
        (activeElement as HTMLElement).blur();
        return;
      }
      if (
        event.key === "Escape" ||
        ((event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void finish();
        return;
      }
      if (
        event.key === "Backspace" ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z")
      ) {
        if (editorFocused) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        undo();
        return;
      }
      if (event.key === "ArrowRight") {
        if (editorFocused) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        animateDecision("archive");
      } else if (event.key === "ArrowLeft") {
        if (editorFocused) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        animateDecision("keep");
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [animateDecision, finish, undo]);

  const caughtUp = notifications !== null && index >= notifications.length;
  useEffect(() => {
    if (!caughtUp || closing) return;
    const timer = setTimeout(() => void finish(), CAUGHT_UP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [caughtUp, closing, finish]);

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (transitioning || !current) return;
    if (isEditorElement(event.target)) {
      touchStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      swiping: false,
    };
    dragXRef.current = 0;
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const touch = event.touches[0];
    if (!start || !touch || transitioning) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (!start.swiping) {
      if (
        Math.abs(deltaX) <= SWIPE_START_THRESHOLD_PX ||
        Math.abs(deltaX) <= Math.abs(deltaY)
      ) {
        return;
      }
      start.swiping = true;
    }
    event.preventDefault();
    dragXRef.current = deltaX;
    setDragX(deltaX);
  };

  const handleTouchEnd = () => {
    if (!touchStartRef.current || transitioning) return;
    const wasSwiping = touchStartRef.current.swiping;
    touchStartRef.current = null;
    const finalDragX = dragXRef.current;
    dragXRef.current = 0;
    if (!wasSwiping) return;
    const threshold = window.innerWidth * 0.35;
    if (Math.abs(finalDragX) >= threshold) {
      animateDecision(finalDragX > 0 ? "archive" : "keep");
      return;
    }
    setTransitioning(true);
    setDragX(0);
    animationTimerRef.current = setTimeout(() => {
      setTransitioning(false);
      animationTimerRef.current = null;
    }, SWIPE_DURATION_MS);
  };

  const handleTouchCancel = () => {
    touchStartRef.current = null;
    dragXRef.current = 0;
    setDragX(0);
  };

  const left = notifications ? Math.max(0, notifications.length - index) : null;
  const loadFailed =
    notifications === null && isError && inbox.notifications.length === 0;
  const rotation = Math.max(-8, Math.min(8, dragX / 32));
  const viewportWidth =
    typeof window === "undefined" ? 1 : Math.max(1, window.innerWidth);
  const opacity = Math.max(0.45, 1 - Math.abs(dragX) / viewportWidth);

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Swipe through unread notifications"
      tabIndex={-1}
      className="fixed inset-0 z-[10000] flex h-[100svh] flex-col overflow-hidden bg-pageBackground px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] text-white-black outline-none md:px-6 md:pb-6"
    >
      <header className="mx-auto flex h-14 w-full max-w-[720px] shrink-0 items-center justify-between">
        <button
          type="button"
          aria-label="Close unread review"
          onClick={() => void finish()}
          disabled={closing}
          className="flex h-10 w-10 items-center justify-start text-text-light-gray transition hover:text-white-black disabled:opacity-50"
        >
          <X size={22} strokeWidth={1.75} />
        </button>
        <span className="text-content font-medium">
          {loadFailed ? "Unavailable" : left === null ? "Loading…" : `${left} left`}
        </span>
        <button
          type="button"
          onClick={undo}
          disabled={decisions.length === 0 || closing}
          className="h-10 min-w-10 text-right text-content font-medium text-text-light-gray transition hover:text-white-black disabled:cursor-default disabled:opacity-30"
        >
          Undo
        </button>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col">
        {loadFailed ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-[5px] bg-cardBackground px-6 text-center shadow-md">
            <h2 className="text-[20px] font-semibold">Unable to load unread</h2>
            <button
              type="button"
              onClick={() => void finish()}
              disabled={closing}
              className="rounded-full bg-hover-active px-5 py-2.5 text-content font-medium text-white-black transition hover:bg-active-modal-element disabled:opacity-50"
            >
              Close
            </button>
          </div>
        ) : notifications === null ? (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-[5px] bg-cardBackground text-content text-text-light-gray shadow-md">
            Loading unread…
          </div>
        ) : caughtUp ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-[5px] bg-cardBackground shadow-md">
            <h2 className="text-[22px] font-semibold">All caught up</h2>
            <button
              type="button"
              onClick={() => void finish()}
              disabled={closing}
              className="rounded-full bg-hover-active px-5 py-2.5 text-content font-medium text-white-black transition hover:bg-active-modal-element disabled:opacity-50"
            >
              Close
            </button>
          </div>
        ) : current ? (
          <div
            key={current.id}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden rounded-[5px] bg-cardBackground shadow-md will-change-transform",
              !isMobile && "md:mx-8"
            )}
            style={{
              touchAction: "pan-y",
              transform: `translateX(${dragX}px) rotate(${rotation}deg)`,
              opacity,
              transition: transitioning
                ? `transform ${SWIPE_DURATION_MS}ms ease, opacity ${SWIPE_DURATION_MS}ms ease`
                : "none",
            }}
          >
            {currentTaskId != null &&
            currentProjectId != null &&
            currentUniqueIndex != null ? (
              <EmbeddedTaskDetail
                taskId={currentTaskId}
                projectId={currentProjectId}
                uniqueIndex={currentUniqueIndex}
                scrollElementRef={taskScrollRef}
              />
            ) : (
              <div className="flex min-h-full items-center justify-center px-6 text-content text-text-light-gray">
                This notification has no task to display
              </div>
            )}
          </div>
        ) : null}

        {!caughtUp && notifications !== null && (
          <div className="flex shrink-0 gap-3 pb-1 pt-4 md:mx-8 md:pt-5">
            <button
              type="button"
              aria-label="Keep in inbox"
              onClick={() => animateDecision("keep")}
              disabled={!current || transitioning || closing}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-hover-active px-4 text-content font-semibold text-white-black transition hover:bg-active-modal-element disabled:opacity-50"
            >
              <ArrowLeft size={17} strokeWidth={1.75} />
              Keep in inbox
            </button>
            <button
              type="button"
              aria-label="Archive"
              onClick={() => animateDecision("archive")}
              disabled={!current || transitioning || closing}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-hypertasks-green px-4 text-content font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
            >
              Archive
              <ArrowRight size={17} strokeWidth={1.75} />
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default SwipeUnread;
