"use client";

import axios from "axios";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState } from "react";
import toast from "react-hot-toast";

import { GetStartedButton } from "../GetStartedButton";

interface IGenerateBoardOnboardingScreen {
  onNextScreen: () => void;
}

export const GenerateBoardOnboardingScreen: React.FC<
  IGenerateBoardOnboardingScreen
> = ({ onNextScreen }) => {
  const router = useRouter();
  const params = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [loadingAction, setLoadingAction] = useState<"generate" | "sample" | null>(
    null
  );
  const existingProjectId = params?.get("projectId");
  const hasProject =
    existingProjectId &&
    existingProjectId.length > 0 &&
    existingProjectId !== "undefined";
  const isLoading = loadingAction !== null;

  const storeProjectAndContinue = (data: {
    projectId: number | string;
    teamId?: string | null;
    teamTitle?: string | null;
  }) => {
    const onboardingParams = new URLSearchParams(params?.toString() ?? "");
    onboardingParams.set("projectId", String(data.projectId));

    if (data.teamId) onboardingParams.set("id", data.teamId);
    if (data.teamTitle) onboardingParams.set("teamTitle", data.teamTitle);

    router.replace(`/onboarding?${onboardingParams.toString()}`);
    onNextScreen();
  };

  const buildBoard = async (skipAi = false) => {
    if (hasProject) {
      onNextScreen();
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (!skipAi && !trimmedPrompt) {
      toast.error("Tell us what you want to manage first.");
      return;
    }

    setLoadingAction(skipAi ? "sample" : "generate");

    try {
      const response = await axios.post("/api/ai/generate-board", {
        prompt: trimmedPrompt,
        teamId: params?.get("id"),
        teamTitle: params?.get("teamTitle"),
        skipAi,
      });

      if (response.status !== 200 || !response.data?.projectId) {
        throw new Error("Board creation failed");
      }

      storeProjectAndContinue(response.data);
    } catch (error) {
      console.log("GenerateBoardOnboardingScreen buildBoard error:", error);
      toast.error("Could not create your board. Please try again.");
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 items-center justify-center max-w-[680px] mx-auto px-4 cursor-default">
      <div className="text-center space-y-3">
        <h2 className="text-heading sm:text-display font-semibold text-white-black">
          What will you use Hypertask for?
        </h2>
        <p className="text-text-light-gray text-emphasis max-w-[560px]">
          Share a few details and Hypertask will build a starter board around
          your actual workflow.
        </p>
      </div>

      <div className="w-full shadow-customshadow-2 bg-comment-description rounded border-thin border-border-light-gray-thin p-4 sm:p-5 space-y-4 text-white-black">
        <textarea
          className="w-full min-h-[180px] text-content px-3 py-3 transition-colors duration-200 resize-none bg-active-list-element outline-none font-normal text-white-black rounded border-thin border-border-light-gray-thin"
          onChange={(event) => setPrompt(event.target.value)}
          value={prompt}
          placeholder="managing a CRO testing roadmap for an e-commerce client"
          disabled={isLoading || Boolean(hasProject)}
        />
      </div>

      <div className="flex flex-col gap-3 items-center">
        <GetStartedButton
          onClick={() => buildBoard(false)}
          disabled={isLoading}
          text={
            hasProject
              ? "Continue"
              : loadingAction === "generate"
                ? "Building your board..."
                : "Generate my board"
          }
        />

        {!hasProject && (
          <button
            className="text-text-light-gray hover:underline transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => buildBoard(true)}
            disabled={isLoading}
            type="button"
          >
            {loadingAction === "sample"
              ? "Building your board..."
              : "Skip — start with a sample board"}
          </button>
        )}
      </div>
    </div>
  );
};
