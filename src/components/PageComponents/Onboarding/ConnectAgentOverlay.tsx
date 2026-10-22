"use client";

import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ModalContainerCustom } from "@/components/Common/CommonModalComponents";

const ConnectAIOnboardingScreen = dynamic(() => import("./Screens/ConnectAIOnboardingScreen").then((module) => module.ConnectAIOnboardingScreen), { ssr: false });

type Props = { sectionId: number; onClose: () => Promise<void> };

export function ConnectAgentOverlay({ sectionId, onClose }: Props) {
  const [visible, setVisible] = useState(() => typeof document !== "undefined" && !document.hidden);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState("");
  const dismissingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const updateVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", updateVisibility);
      queueMicrotask(() => {
        const target = document.querySelector<HTMLElement>(`#droppable-section-container-${sectionId} .create-new-task-button`);
        if (target && !document.getElementById("connect-agent-overlay")) {
          target.tabIndex = -1;
          target.focus();
        }
      });
    };
  }, [sectionId]);

  const dismiss = async () => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    setDismissing(true);
    setError("");
    try {
      const response = await fetch("/api/users/ai-connection-status?mode=overlay", { method: "POST" });
      if (!response.ok) throw new Error();
      if (mounted.current) await onClose();
    } catch {
      if (mounted.current) setError("Could not dismiss. Please try again.");
    } finally {
      dismissingRef.current = false;
      if (mounted.current) setDismissing(false);
    }
  };

  return (
    <ModalContainerCustom
      id="connect-agent-overlay"
      isOpen
      autoFocus
      trapFocus
      keyboard
      backdrop="static"
      toggle={() => void dismiss()}
      aria-label="Connect your agent"
      className="w-full max-w-[720px]"
      contentClassName="max-h-[80dvh] overflow-y-auto p-3"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-emphasis font-medium">Connect your agent</h2>
        <button type="button" onClick={() => void dismiss()} disabled={dismissing} className="min-h-12 px-2 text-meta text-text-light-gray hover:text-white-black disabled:opacity-50">
          Skip
        </button>
      </div>
      <ConnectAIOnboardingScreen compact visible={visible} serverEligible overlay onConnected={() => void onClose()} onNextScreen={() => void dismiss()} />
      {error && <p role="alert" className="mt-2 text-meta text-text-light-gray">{error}</p>}
    </ModalContainerCustom>
  );
}
