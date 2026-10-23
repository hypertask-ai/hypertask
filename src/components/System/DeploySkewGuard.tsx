"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  decideHiddenReload,
  decideIdleReload,
  isDeploySkewReloadEligiblePath,
} from "./deploySkewGuardLogic";
import { consumeEarlyAppShellBootstrapSlice } from "@/lib/appShellBootstrap/client";


const POLL_MS = 3 * 60 * 1000;
const HIDDEN_GRACE_MS = 10 * 1000;
const IDLE_RELOAD_MS = 30 * 60 * 1000;
const PREFLIGHT_TIMEOUT_MS = 8 * 1000;
const UNREACHABLE_RETRY_MS = 60 * 1000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];

async function fetchServerBuildId(): Promise<string | null> {
  try {
    const bootstrapped =
      await consumeEarlyAppShellBootstrapSlice<string>("buildId");
    if (typeof bootstrapped === "string") return bootstrapped;
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.buildId === "string" ? data.buildId : null;
  } catch {
    return null;
  }
}

async function canReachCurrentPage(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    const res = await fetch(window.location.href, {
      cache: "reload",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function isEditingActively(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === "TEXTAREA") {
    return (el as HTMLTextAreaElement).value.trim() !== "";
  }
  if (el.tagName === "INPUT") {
    const input = el as HTMLInputElement;
    const textLike = [
      "text",
      "search",
      "email",
      "url",
      "tel",
      "number",
      "password",
    ].includes(input.type);
    return textLike && input.value.trim() !== "";
  }
  if (el.isContentEditable) {
    return (el.textContent ?? "").trim() !== "";
  }
  return false;
}

export default function DeploySkewGuard() {
  const staleRef = useRef(false);
  const pathname = usePathname();
  const reloadEligible = isDeploySkewReloadEligiblePath(pathname);

  useEffect(() => {
    if (!reloadEligible) {
      staleRef.current = false;
      return;
    }

    const myBuildId = process.env.NEXT_PUBLIC_BUILD_ID;
    if (!myBuildId || myBuildId === "dev") return;

    let cancelled = false;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    let idleTimer: ReturnType<typeof setInterval> | null = null;
    let activityBound = false;
    let lastActivity = Date.now();
    let visibilityCycle = 0;

    const clearReloadTimer = () => {
      if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }
    };

    const doReload = async () => {
      const expectedVisibilityCycle = visibilityCycle;
      const decision = await decideHiddenReload({
        expectedVisibilityCycle,
        getVisibilityCycle: () => visibilityCycle,
        getVisibilityState: () => document.visibilityState,
        isCancelled: () => cancelled,
        isEditing: isEditingActively,
        canReachOrigin: canReachCurrentPage,
      });

      if (decision === "reload") {
        window.location.reload();
      } else if (decision === "retry") {
        armReload(UNREACHABLE_RETRY_MS);
      }
    };

    const armReload = (delay = HIDDEN_GRACE_MS) => {
      clearReloadTimer();
      reloadTimer = setTimeout(doReload, delay);
    };

    const bumpActivity = () => {
      lastActivity = Date.now();
    };

    const idleReloadCheck = async () => {
      const expectedVisibilityCycle = visibilityCycle;
      const decision = await decideIdleReload({
        expectedVisibilityCycle,
        getVisibilityCycle: () => visibilityCycle,
        getVisibilityState: () => document.visibilityState,
        isCancelled: () => cancelled,
        isEditing: isEditingActively,
        isIdle: () => Date.now() - lastActivity >= IDLE_RELOAD_MS,
        canReachOrigin: canReachCurrentPage,
      });
      if (decision === "reload") window.location.reload();
    };

    const beginIdleWatch = () => {
      lastActivity = Date.now();
      if (!activityBound) {
        ACTIVITY_EVENTS.forEach((e) =>
          window.addEventListener(e, bumpActivity, { passive: true })
        );
        activityBound = true;
      }
      if (!idleTimer) idleTimer = setInterval(idleReloadCheck, 60 * 1000);
    };

    const stopIdleWatch = () => {
      if (idleTimer) {
        clearInterval(idleTimer);
        idleTimer = null;
      }
      if (activityBound) {
        ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, bumpActivity));
        activityBound = false;
      }
    };

    const check = async () => {
      if (staleRef.current) return;
      const serverBuildId = await fetchServerBuildId();
      if (cancelled || !serverBuildId) return;
      if (serverBuildId !== myBuildId) {
        staleRef.current = true;
        if (document.visibilityState === "hidden") armReload();
        else beginIdleWatch();
      }
    };

    const onVisibility = () => {
      visibilityCycle += 1;
      if (document.visibilityState === "hidden") {
        if (staleRef.current) armReload();
      } else {
        clearReloadTimer();
        if (staleRef.current) beginIdleWatch();
        else check();
      }
    };

    check();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearReloadTimer();
      stopIdleWatch();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reloadEligible]);

  return null;
}
