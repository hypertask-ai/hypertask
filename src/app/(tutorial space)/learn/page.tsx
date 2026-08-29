"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import LoadingSpinner1 from "@/components/LoadingSpinners/LoadingSpinner1";

const getReturnBoardId = () => {
  const encodedPreviousBoard = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("previousBoard="))
    ?.split("=")[1];
  if (!encodedPreviousBoard) return null;

  try {
    const returnBoardId = Number(
      decodeURIComponent(encodedPreviousBoard)
        .split("|&|")[0]
        ?.replace("project-", ""),
    );
    return Number.isSafeInteger(returnBoardId) && returnBoardId > 0
      ? returnBoardId
      : null;
  } catch {
    return null;
  }
};

const LearnPage = () => {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const provisionBoard = useCallback(async () => {
    setError(null);
    try {
      const returnBoardId = getReturnBoardId();
      const response = await fetch("/api/learn/board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(returnBoardId !== null ? { returnBoardId } : {}),
      });
      const data = (await response.json()) as {
        boardUrl?: string;
        error?: string;
      };
      if (!response.ok || !data.boardUrl) {
        throw new Error(data.error || "Could not prepare your tutorial board");
      }
      window.location.assign(data.boardUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not prepare your tutorial board",
      );
    }
  }, []);

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
          <LoadingSpinner1
            size={40}
            thickness={4}
            color="var(--color-text-light-gray)"
          />
          <p className="text-[13px] text-text-light-gray">
            Preparing your tutorial board…
          </p>
        </>
      )}
    </main>
  );
};

export default LearnPage;
