"use client";
import { useRouter, useSearchParams } from "next/navigation";
import nookies from "nookies";
import { GetStartedButton } from "../GetStartedButton";

interface ITutorialOnboardingScreen {
  onNextScreen: () => void;
}

const SHORTCUT_PREVIEWS: Array<{ keys: string[]; action: string }> = [
  { keys: ["J", "K"], action: "Move through tasks" },
  { keys: ["Ctrl", "K"], action: "Command anything" },
  { keys: ["E"], action: "Clear your inbox" },
  { keys: ["?"], action: "See every shortcut" },
];

export const TutorialOnboardingScreen: React.FC<ITutorialOnboardingScreen> = ({
  onNextScreen,
}) => {
  const params = useSearchParams();
  const router = useRouter();

  const startTutorial = () => {
    const projectId = params?.get("projectId") || "";
    const teamTitle = params?.get("teamTitle") || "";
    const teamId = params?.get("id") || "";

    // Don't complete onboarding here: the tutorial is launched mid-sequence.
    // Drop a cookie so exiting/finishing the tutorial returns to onboarding at the
    // Launch step, letting the user finish the sequence instead of restarting it.
    const returnParams = new URLSearchParams({
      projectId,
      teamTitle,
      id: teamId,
      resumeKey: "launch-screen",
    });
    nookies.set(null, "onboarding_return", `/onboarding?${returnParams.toString()}`, {
      maxAge: 60 * 60, // 1 hour
      path: "/",
    });

    const searchParams = new URLSearchParams({
      scene: "0",
      projectId,
      teamTitle,
      id: teamId,
      launch: "true", // show the "Exit Tutorial" affordance so early exit is possible
    });
    router.push(`/interactive-onboarding/landing?${searchParams.toString()}`);
  };

  return (
    <div className="flex flex-col gap-6 items-center justify-center max-w-[600px] mx-auto px-4 cursor-default text-center">
      <div className="space-y-3">
        <h2 className="text-heading sm:text-display font-semibold text-white-black">
          Now learn to fly.
        </h2>
        <p className="text-text-light-gray text-emphasis max-w-[520px]">
          Hypertask is keyboard-first, like Superhuman. The 5-minute
          interactive tutorial teaches you to move through your board without
          ever touching the mouse. It&apos;s the fastest way to feel fast.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-x-8 gap-y-4">
        {SHORTCUT_PREVIEWS.map((shortcut) => (
          <div
            key={shortcut.action}
            className="flex flex-col items-center gap-1.5"
          >
            <div className="flex items-center gap-1">
              {shortcut.keys.map((key) => (
                <kbd
                  key={key}
                  className="rounded border-thin border-border-light-gray-thin bg-taskDetal-container px-2 py-1 font-mono text-meta text-white-black"
                >
                  {key}
                </kbd>
              ))}
            </div>
            <span className="text-meta text-text-light-gray">
              {shortcut.action}
            </span>
          </div>
        ))}
      </div>

      <GetStartedButton onClick={startTutorial} text="Start the 5-minute tutorial" />

      <button
        type="button"
        onClick={onNextScreen}
        className="text-meta text-text-light-gray hover:text-white-black hover:underline"
      >
        Skip, I&apos;ll learn as I go
      </button>

      <p className="text-micro text-text-light-gray">
        You can reopen it anytime with{" "}
        <kbd className="rounded border-thin border-border-light-gray-thin bg-taskDetal-container px-1 py-0.5 font-mono">
          Ctrl+K
        </kbd>{" "}
        &rarr; Interactive tutorial
      </p>
    </div>
  );
};
