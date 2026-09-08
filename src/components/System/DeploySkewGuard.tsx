"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  decideHiddenReload,
  decideIdleReload,
  isDeploySkewReloadEligiblePath,
} from "./deploySkewGuardLogic";
import { consumeEarlyAppShellBootstrapSlice } from "@/lib/appShellBootstrap/client";

// Silent auto-update (deploy-skew guard, HTPR-4574). A single-page tab keeps
// running whatever bundle it loaded, so a shipped fix can be live for days
// while an open tab still runs the old, buggy code. This detects a newer deploy
// and reloads the tab once it has been in the background for a moment — no
// banner, no button, Linear-style. State restores from the URL after reload.
// Collaborative /project routes are excluded: they already reconcile in place,
// and production's deploy cadence made forced board reloads disruptive.
//
// Two guards keep it from ever eating work:
//   1. It only reloads while the tab is HIDDEN, and only after a short grace
//      delay (cancelled the instant you return) — so an in-flight save
//      finishes and a quick alt-tab never triggers it.
//   2. It refuses to reload while the FOCUSED element is a non-empty text field
//      or rich-text editor (you are mid-edit). Note: descriptions/comments here
//      are always-editable Tiptap holding saved content, so we must check the
//      *focused* element, not "any contenteditable on the page".
//   3. It proves the page is reachable immediately before navigating, and a
//      visibility change invalidates that proof before it can trigger reload.
//
// A tab that stays visible and is never backgrounded is handled separately
// (HTPR-4578): once a newer build is known, if the user has not interacted for
// IDLE_RELOAD_MS they have clearly walked away, so we reload then too. Activity
// listeners attach only after a new build is detected — no cost in normal use.
//
// ponytail: the residual gap is a blurred, unsent composer draft on a tab
// abandoned past the grace delay — same outcome as closing the tab. Upgrade
// path if it ever bites: persist composer drafts.

const POLL_MS = 3 * 60 * 1000; // check for a new build every 3 min while visible
const HIDDEN_GRACE_MS = 10 * 1000; // stay hidden this long before reloading
const IDLE_RELOAD_MS = 30 * 60 * 1000; // reload a still-visible tab after this much no-interaction
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

// Reload is a one-way door in an installed PWA: a navigation attempted while
// Android's radio is asleep can replace the working app with an unrecoverable
// ERR_TIMED_OUT page. Probe the exact URL we are about to reload; proving only
// a different origin path would leave routing and edge failures uncovered.
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

// Is the user actively typing right now? Only the focused element counts —
// unfocused saved content (a rendered description/comment) must not block.
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
    // No stable build id (local dev, or var not wired) → nothing to compare.
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

    // Start watching for a walked-away (idle + visible) tab. Idempotent; each
    // call also treats "now" as activity, since re-entering the tab is activity.
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
      if (staleRef.current) return; // already known stale
      const serverBuildId = await fetchServerBuildId();
      if (cancelled || !serverBuildId) return;
      if (serverBuildId !== myBuildId) {
        staleRef.current = true;
        if (document.visibilityState === "hidden") armReload();
        else beginIdleWatch();
      }
    };

    const onVisibility = () => {
      // Invalidate every in-flight reachability result before handling the new
      // state. In particular, hidden(A) -> visible -> hidden(B) must wait for
      // B's own grace period and preflight rather than reuse A's result.
      visibilityCycle += 1;
      if (document.visibilityState === "hidden") {
        if (staleRef.current) armReload();
      } else {
        clearReloadTimer(); // came back → cancel any pending reload
        if (staleRef.current) beginIdleWatch(); // resume idle watch, reset timer
        else check(); // and check for a fresh build
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
