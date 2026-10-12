"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import LoadingSpinner1 from "@/components/LoadingSpinners/LoadingSpinner1";

// HTPR-4875: /demo lands straight on a board. Sending no purpose means an empty
// board for a new visitor, and the board they already have for a returning
// guest. AI generation happens only in the Ctrl+K board creation assistant.

const DemoBoardPage = ({ retryNetworkErrors }: { retryNetworkErrors: boolean }) => {

  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const provisionBoard = useCallback(async () => {
    setError(null);
    try {
      let response: Response;
      for (let attempt = 0; ; attempt += 1) {
        try {
          response = await fetch("/api/demo/guest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          break;
        } catch (caught) {
          if (!retryNetworkErrors) throw caught;
          if (attempt === 2) {
            throw new Error("Could not reach Hypertask. Check your connection.");
          }
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
        }
      }
      const data = (await response.json()) as {
        boardUrl?: string;
        error?: string;
      };
      if (!response.ok || !data.boardUrl) {
        throw new Error(data.error || "Could not create your demo board");
      }
      // Hard navigation, not router.push: the guest session cookies were set by
      // this fetch response, and a client-side transition races the app shell
      // that already booted without a user ("Something went wrong" on first
      // load). A full load boots the board with the session in place.
      window.location.assign(data.boardUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create your demo board",
      );
    }
  }, [retryNetworkErrors]);

  useEffect(() => {
    // React 18 strict mode mounts twice; provisioning twice would burn the
    // per-IP guest rate limit.
    if (started.current) return;
    started.current = true;
    void provisionBoard();
  }, [provisionBoard]);

  return (
    <main className="flex min-h-[100svh] flex-col items-center justify-center gap-4 bg-pageBackground">
      {error ? (
        <>
          <p role="alert" className="text-[13px] text-red-400">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void provisionBoard()}
            className="text-[13px] text-text-light-gray hover:underline"
          >
            Try again
          </button>
        </>
      ) : (
        <>
          <LoadingSpinner1 size={40} thickness={4} color="#8E9093" />
          <p className="text-[13px] text-text-light-gray">
            Creating your private demo board…
          </p>
        </>
      )}
    </main>
  );
};

export default DemoBoardPage;
