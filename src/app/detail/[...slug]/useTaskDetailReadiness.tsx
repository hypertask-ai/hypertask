
import { useEffect, useLayoutEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7002_INBOX_E_FIRST_PRESS_FLAG, HTPR_7004_NO_LOADING_FLASH_FLAG } from "@/lib/flags/keys";
import { focusManager } from "@tanstack/react-query";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { emitProductPerformanceEvent } from "@/lib/analytics/productPerformance";
import { performanceDeviceClass } from "@/lib/analytics/appPerformanceScope";
import { consumeTaskDetailReadinessSample, TASK_DETAIL_READINESS_MAX_MS, taskDetailUsableDomPresent } from "@/lib/analytics/taskDetailReadiness";
import { markTaskDetailPhase, readTaskDetailPhaseTimings, TASK_DETAIL_USABLE_MARK } from "@/lib/analytics/taskDetailPhaseTimings";
import type { useTaskDetailInitialScrollValue } from "./useTaskDetailInitialScroll";
export function useTaskDetailReadiness(context: useTaskDetailInitialScrollValue) {
  const inboxEFirstPress = useFlag(HTPR_7002_INBOX_E_FIRST_PRESS_FLAG);
  const noLoadingFlash = useFlag(HTPR_7004_NO_LOADING_FLASH_FLAG);
  const { cachedLayout } = useTaskContext();
  const { embedded, _currentTask, _parsedTask, handleKeyDown, handleKeyUp, sharedLink, isRecording, showMentionList, currentTask, carousalItems, getTask, setNonEssentialReady, readinessTaskRef, currentUser, updateActiveItemAndItemInView, setStickyElementHeight, showAiChatInterface, onWindowFocus } = context;

  useEffect(() => {
    if (embedded) return;

    // Add event listeners when the component mounts
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    const path = `/detail/project-${currentTask?.projectId}/${currentTask?.uniqueIndex}`;
    if (inboxEFirstPress) window.dispatchEvent(new CustomEvent("htpr-7002-detail-keyboard", {
      detail: { path, handleKeyDown, ready: currentTask?._count?.notifications !== undefined },
    }));

    // Remove event listeners when the component unmounts
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      if (inboxEFirstPress) window.dispatchEvent(new CustomEvent("htpr-7002-detail-keyboard", {
        detail: { path, ready: false },
      }));
    };
  }, [
    handleKeyDown,
    handleKeyUp,
    sharedLink,
    isRecording,
    showMentionList,
    currentTask,
    carousalItems,
    embedded,
    inboxEFirstPress,
  ]);

  useEffect(() => {
    // The cached query revalidates on mount; another RSC refresh can race Back and trigger Next's MPA fallback.
    getTask(!(noLoadingFlash && cachedLayout));
  }, [_currentTask, noLoadingFlash, cachedLayout]);

  useEffect(() => {
    const readinessTask = `${_parsedTask.projectId}:${_parsedTask.id}`;
    // Embedded views (swipe-unread) don't run this readiness tracking at all,
    // so non-essential requests there have nothing to wait on - let them fire
    // immediately rather than never.
    if (embedded) {
      setNonEssentialReady(true);
      return;
    }
    if (readinessTaskRef.current === readinessTask) return;
    setNonEssentialReady(false);

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    // The 30s timer below still publishes the real readiness event (a task
    // that never reaches the DOM markers - share view, no description editor,
    // permission-limited, an error state - is a genuine measurement failure
    // worth keeping). But the non-essential gate has no reason to make AI
    // suggestions, the share link and the move-task sections wait that long:
    // fail it open after 3s regardless (HTPR-6047).
    const nonEssentialFallback = setTimeout(
      () => setNonEssentialReady(true),
      3000,
    );
    const cleanup = () => {
      if (frame) cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      clearTimeout(nonEssentialFallback);
      observer?.disconnect();
    };
    const publish = (timedOut = false) => {
      if (readinessTaskRef.current === readinessTask) return;
      const measured = consumeTaskDetailReadinessSample();
      const sample = timedOut
        ? {
            ...measured,
            measurementEligible: false as const,
            exclusionReason: "usable_state_timeout" as const,
          }
        : measured;
      readinessTaskRef.current = readinessTask;
      if (!timedOut) markTaskDetailPhase(TASK_DETAIL_USABLE_MARK);
      // HTPR-6047: phase attribution for the gap. Read after the usable mark
      // above so phase_usable_ms can see it - a timed-out publish never sets
      // that mark, so phase_usable_ms stays null on that path, matching
      // exclusion_reason rather than reporting a fake completion time.
      const phaseTimings = readTaskDetailPhaseTimings();
      emitProductPerformanceEvent(
        {
          event: "app_task_detail_readiness",
          properties: {
            analytics_surface: "authenticated_app",
            app_hostname: window.location.hostname,
            route_family: "task_detail",
            route_path: "/detail",
            entry_path: sample.entryPath,
            navigation_mode: sample.navigationMode,
            navigation_type: sample.navigationType,
            duration_ms: sample.durationMs,
            device_class: performanceDeviceClass(),
            project_id: Number(_parsedTask.projectId),
            task_id: Number(_parsedTask.id),
            measurement_eligible: sample.measurementEligible,
            exclusion_reason: sample.exclusionReason,
            readiness_measurement_version: 1,
            readiness_measurement_scope: "task_detail_open_to_usable",
            ...phaseTimings,
          },
        },
        currentUser.id!,
      );
      setNonEssentialReady(true);
      cleanup();
    };
    const checkReady = () => {
      frame = 0;
      if (taskDetailUsableDomPresent(document)) publish();
    };
    const scheduleCheck = () => {
      if (!frame) frame = requestAnimationFrame(checkReady);
    };

    observer = new MutationObserver(scheduleCheck);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    timer = setTimeout(() => publish(true), TASK_DETAIL_READINESS_MAX_MS);
    // HTPR-6047: the rAF+MutationObserver path alone can silently lose a
    // scheduled check across a tab freeze/resume (backgrounding, sleep/wake,
    // OS-level suspension) - reproduced via CDP Page.setWebLifecycleState.
    // A plain interval keeps firing across that gap, so it catches
    // usability even when the primary path drops its pending check.
    poll = setInterval(checkReady, 250);
    scheduleCheck();
    return cleanup;
  }, [currentUser.id, embedded, _parsedTask.id, _parsedTask.projectId, setNonEssentialReady]);

  useLayoutEffect(() => {
    updateActiveItemAndItemInView(currentTask?.id ?? null);
    setStickyElementHeight();
  }, []); // Empty dependency array, so it runs once on mount

  // Opening/closing the AI chat sidebar resizes the main content and reflows the
  // title, changing its height. The ResizeObserver can miss the settled height
  // across that layout swap, leaving the sticky header overlapping the task body
  // until a reload. Recompute after the toggle's layout settles (rAF).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setStickyElementHeight());
    return () => cancelAnimationFrame(raf);
  }, [showAiChatInterface]);

  useEffect(() => {
    console.log("🚀 ~ parsed task priority:", _parsedTask.priority);
    console.log("🚀 ~ parsed task estimate:", _parsedTask.estimate);
  }, []);

  focusManager.setEventListener(onWindowFocus);

}
