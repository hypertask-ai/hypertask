
import { useEffect, useLayoutEffect } from "react";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG } from "@/lib/flags/keys";
import { focusManager } from "@tanstack/react-query";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { emitProductPerformanceEvent } from "@/lib/analytics/productPerformance";
import { performanceDeviceClass } from "@/lib/analytics/appPerformanceScope";
import { consumeTaskDetailReadinessSample, TASK_DETAIL_READINESS_MAX_MS, taskDetailUsableDomPresent } from "@/lib/analytics/taskDetailReadiness";
import { markTaskDetailPhase, readTaskDetailPhaseTimings, TASK_DETAIL_USABLE_MARK } from "@/lib/analytics/taskDetailPhaseTimings";
import type { useTaskDetailInitialScrollValue } from "./useTaskDetailInitialScroll";
export function useTaskDetailReadiness(context: useTaskDetailInitialScrollValue) {
  const flagReady = useFlagReady(HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG);
  const dedupe = useFlag(HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG);
  const { cachedLayout } = useTaskContext();
  const { embedded, _currentTask, _parsedTask, handleKeyDown, handleKeyUp, sharedLink, isRecording, showMentionList, currentTask, carousalItems, getTask, setNonEssentialReady, readinessTaskRef, currentUser, updateActiveItemAndItemInView, setStickyElementHeight, showAiChatInterface, onWindowFocus } = context;

  useEffect(() => {
    if (embedded) return;

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    const path = `/detail/project-${currentTask?.projectId}/${currentTask?.uniqueIndex}`;
    window.dispatchEvent(new CustomEvent("htpr-7002-detail-keyboard", {
      detail: { path, handleKeyDown, ready: currentTask?._count?.notifications !== undefined },
    }));

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      window.dispatchEvent(new CustomEvent("htpr-7002-detail-keyboard", {
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
  ]);

  useEffect(() => {
    getTask(flagReady && !dedupe && !(cachedLayout || window.history.state?.cachedTaskDetail?.taskId === _parsedTask.id));
  }, [_currentTask, _parsedTask.id, cachedLayout, dedupe, flagReady]);

  useEffect(() => {
    const readinessTask = `${_parsedTask.projectId}:${_parsedTask.id}`;
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
    poll = setInterval(checkReady, 250);
    scheduleCheck();
    return cleanup;
  }, [currentUser.id, embedded, _parsedTask.id, _parsedTask.projectId, setNonEssentialReady]);

  useLayoutEffect(() => {
    updateActiveItemAndItemInView(currentTask?.id ?? null);
    setStickyElementHeight();
  }, []);

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
