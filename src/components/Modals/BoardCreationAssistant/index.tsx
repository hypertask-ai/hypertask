"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ModalBody } from "reactstrap";
import { Sparkles, X } from "lucide-react";

import { ModalContainerCustom } from "@/components/Common/CommonModalComponents";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";
import { generateGuestBoard } from "@/lib/demo/guestBoardBuild";

const PROMPT_EXAMPLES = [
  "Launch a marketing campaign",
  "Plan a wedding in Italy",
  "Build a SaaS MVP",
  "Open a coffee roastery",
];

// Guests regenerate their single demo board through the demo route; signed-in
// users get a new board in their current team from the onboarding generator.
async function generateBoard(
  purpose: string,
  isGuest: boolean,
  idempotencyKey: string,
) {
  if (isGuest) return generateGuestBoard(purpose);

  const response = await fetch("/api/ai/generate-board", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ prompt: purpose }),
    signal: AbortSignal.timeout(45000),
  });
  const data = (await response.json()) as { projectId?: number; error?: string };
  if (!response.ok || !data.projectId) {
    throw new Error(data.error || "Could not create your board");
  }
  return `/project?id=${data.projectId}`;
}

const BoardCreationAssistant = ({ onClose }: { onClose: () => void }) => {
  const router = useRouter();
  const [purpose, setPurpose] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const pendingRequestRef = useRef<{ prompt: string; key: string } | null>(
    null,
  );

  useEffect(() => setIsGuest(isGuestCookieUser()), []);

  const submit = useCallback(
    async (nextPurpose: string) => {
      const trimmed = nextPurpose.trim();
      setPurpose(nextPurpose);
      if (generating) return;
      if (trimmed.length < 3) {
        setError("Describe your project in at least 3 characters.");
        return;
      }

      const pendingRequest = pendingRequestRef.current;
      const idempotencyKey =
        pendingRequest?.prompt === trimmed
          ? pendingRequest.key
          : crypto.randomUUID();
      pendingRequestRef.current = { prompt: trimmed, key: idempotencyKey };

      setGenerating(true);
      setError(null);
      try {
        router.push(await generateBoard(trimmed, isGuest, idempotencyKey));
        pendingRequestRef.current = null;
        // The palette owns this modal's lifetime, so it survives the route
        // change unless the command mode is cleared.
        onClose();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not create your board",
        );
        setGenerating(false);
      }
    },
    [generating, isGuest, onClose, router],
  );

  return (
    <ModalContainerCustom
      id="board-creation-assistant"
      isOpen
      toggle={onClose}
      autoFocus={false}
      backdrop={false}
      keyboard={!generating}
      shouldCloseOnClickOutside={!generating}
      className="sm:max-h-fit sm:top-[15%] sm:min-w-[540px]"
    >
      <ModalBody className="p-0">
        <div className="relative px-6 pb-6 pt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={generating}
            aria-label="Close"
            className="absolute right-4 top-4 rounded p-1 text-text-light-gray transition-colors hover:text-white-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} />
          </button>

          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-400" />
            <p className="text-[19px] font-semibold text-white-black">
              What do you want to manage?
            </p>
          </div>
          <p className="mt-1 text-[13px] text-text-light-gray">
            Describe your project and watch the board build itself with AI.
          </p>

          <div className="mt-4 border-b border-light-black-border-1">
            <input
              id="board-creation-assistant-input"
              autoFocus
              autoComplete="off"
              disabled={generating}
              placeholder="e.g. Launch our new marketing site"
              value={purpose}
              onChange={(event) => {
                pendingRequestRef.current = null;
                setPurpose(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit(purpose);
                }
              }}
              className="h-[46px] w-full bg-transparent text-[17px] text-white-black outline-none placeholder:text-text-light-gray disabled:cursor-wait disabled:opacity-70"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[12px] text-text-light-gray">Try</span>
            {PROMPT_EXAMPLES.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={generating}
                onClick={() => void submit(prompt)}
                className="rounded-full bg-label-span px-3 py-1.5 text-[12px] font-medium text-white-black transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>

          <p
            role={error ? "alert" : undefined}
            className={`mt-4 text-[12px] ${error ? "text-red-400" : "text-text-light-gray"}`}
          >
            {error ??
              (generating
                ? "Building your board…"
                : "Press Enter to create your board.")}
          </p>
          {isGuest && (
            // Full navigation (not next/link): the reset route clears the guest
            // session cookies and 307-redirects, which client-side routing skips.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a
              href="/api/demo/reset"
              className="mt-2 inline-block text-micro text-text-light-gray hover:underline"
            >
              Restart demo from scratch
            </a>
          )}
        </div>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default BoardCreationAssistant;
