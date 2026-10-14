"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import LoadingSpinner1 from "@/components/LoadingSpinners/LoadingSpinner1";


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
