"use client";

import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7026_AGENT_CONNECT_CHECK_FLAG, HTPR_7041_AGENT_CONNECT_OVERLAY_FLAG } from "@/lib/flags/keys";
import { AgentConnectOverlay } from "./AgentConnectOverlay";

const ConnectAIOnboardingScreen = dynamic(() => import("./Screens/ConnectAIOnboardingScreen").then((module) => module.ConnectAIOnboardingScreen), { ssr: false });

/** HTPR-7041: with the overlay flag on, the block above the board never renders; the MCP dialog opens instead. */
export function AgentConnectCard(props: { projectId: number; userId: number }) {
  const overlayOn = useFlag(HTPR_7041_AGENT_CONNECT_OVERLAY_FLAG);
  return overlayOn ? <AgentConnectOverlay {...props} /> : <AgentConnectCardBlock {...props} />;
}

function AgentConnectCardBlock({ projectId, userId }: { projectId: number; userId: number }) {
  const flagEnabled = useFlag(HTPR_7026_AGENT_CONNECT_CHECK_FLAG);
  const identity = `${userId}:${projectId}`;
  const [state, setState] = useState<{ identity: string; eligible: boolean; show: boolean } | null>(null);
  const serverEligible = state?.identity === identity && state.eligible;
  const show = state?.identity === identity && state.show;

  useEffect(() => {
    const controller = new AbortController();
    // Revalidate on flag changes and every minute so an expired QA arm or a
    // flag switched off removes the card.
    const load = () => void fetch("/api/users/ai-connection-status?mode=first", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          if (!controller.signal.aborted) setState({ identity, eligible: false, show: false });
          return;
        }
        const data = await response.json();
        if (!controller.signal.aborted) {
          setState({ identity, eligible: data.eligible === true, show: !data.connected && !data.dismissed && data.boardId === projectId });
        }
      }).catch(() => undefined);
    load();
    const intervalId = setInterval(load, 60_000);
    return () => {
      controller.abort();
      clearInterval(intervalId);
    };
  }, [identity, projectId, flagEnabled]);

  return (flagEnabled ? true : serverEligible) && show
    ? <EligibleAgentConnectCard key={identity} serverEligible={serverEligible} />
    : null;
}

function EligibleAgentConnectCard({ serverEligible }: { serverEligible: boolean }) {
  const [eligible, setEligible] = useState(true);
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState("");
  const element = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!eligible || !element.current) return;
    let inView = false;
    const updateVisibility = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      updateVisibility();
    });
    observer.observe(element.current);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, [eligible]);

  const dismiss = async () => {
    setDismissing(true);
    setError("");
    try {
      const response = await fetch("/api/users/ai-connection-status", { method: "POST" });
      if (!response.ok) throw new Error();
      setEligible(false);
    } catch {
      setError("Could not dismiss. Please try again.");
    } finally {
      setDismissing(false);
    }
  };

  if (!eligible) return null;
  return (
    <section ref={element} aria-label="Connect your agent" className="mx-auto w-full max-w-[720px] rounded-[5px] border-thin border-border-light-gray-thin bg-comment-description p-3 text-white-black">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-emphasis font-medium">Connect your agent</h2>
        <button type="button" onClick={() => void dismiss()} disabled={dismissing} className="min-h-12 px-2 text-meta text-text-light-gray hover:text-white-black disabled:opacity-50">
          Dismiss
        </button>
      </div>
      <ConnectAIOnboardingScreen compact visible={visible} serverEligible={serverEligible} onNextScreen={() => void dismiss()} />
      {error && <p role="alert" className="mt-2 text-meta text-text-light-gray">{error}</p>}
    </section>
  );
}
