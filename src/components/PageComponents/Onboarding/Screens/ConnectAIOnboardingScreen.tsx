"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, Sparkles } from "lucide-react";

import {
  INSTALL_COMMAND,
  LOGIN_COMMAND,
} from "@/components/Modals/CliInstall/constants";
import {
  ConnectInstructions,
  TokenStatusBar,
  getIntegrationChipClassName,
} from "@/components/Modals/McpToken/components";
import { CopyableCodeBlock } from "@/components/Modals/McpToken/components/ConnectInstructions";
import { useMcpToken } from "@/components/Modals/McpToken/hooks/useMcpToken";
import type { IntegrationId } from "@/components/Modals/McpToken/utils";
import { cn } from "@/utils/undoActions/helperFuncs";
import { GetStartedButton } from "../GetStartedButton";

interface IConnectAIOnboardingScreen {
  onNextScreen: () => void;
}

type ToolChoice = IntegrationId | "builtin";

const TOOL_CHOICES: Array<{ id: ToolChoice; label: string }> = [
  { id: "builtin", label: "Hypertask AI" },
  { id: "claude", label: "Claude (desktop / web)" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
];

function UseCaseRow({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1.5 text-meta text-text-light-gray">
      <CircleCheck
        size={13}
        className="flex-shrink-0 text-hypertasks-ai-purple"
        aria-hidden
       strokeWidth={1.75}/>
      {text}
    </span>
  );
}

const BUILTIN_USE_CASES = [
  "Build and manage your own AI agents",
  "Triage your inbox automatically",
  "Plan your week from a sentence",
  "Turn a note into tasks",
];

// Weighted: chat apps most people use first, terminal tools for developers.
const TOOL_TIERS: Array<{
  heading: string;
  blurb: string;
  useCases: string[];
  tools: ToolChoice[];
}> = [
  {
    heading: "In your chat app",
    blurb: "Ask about and update your board from the app you chat with daily.",
    useCases: [
      "Pull up a ticket mid-chat",
      "Create and update tasks",
      "Ask what's due this week",
    ],
    tools: ["claude", "chatgpt"],
  },
  {
    heading: "In your terminal or editor",
    blurb: "Give your coding agent access to your board.",
    useCases: [
      "Your agent reads, creates and moves tickets",
      "Coordinate a whole project with your agent",
      "The bridge between you and your AI agents",
    ],
    tools: ["claude-code", "codex", "cursor", "vscode"],
  },
];

type ConnectMethod = "cli" | "mcp" | "rest";

const METHOD_LABELS: Record<ConnectMethod, string> = {
  cli: "CLI",
  mcp: "MCP",
  rest: "REST API",
};

// Terminal-capable tools can drive Hypertask three ways; chat apps only via MCP connector.
const TOOL_METHODS: Partial<Record<ToolChoice, ConnectMethod[]>> = {
  "claude-code": ["cli", "mcp", "rest"],
  codex: ["cli", "mcp", "rest"],
  cursor: ["cli", "mcp", "rest"],
  vscode: ["cli", "mcp", "rest"],
};

const REST_BASE_URL =
  process.env.NEXT_PUBLIC_BASEURL || "https://app.hypertask.ai";

interface ConnectionStatusProps {
  label: string;
  onConnected: () => void;
}

function ConnectionStatus({ label, onConnected }: ConnectionStatusProps) {
  const [connected, setConnected] = useState(false);
  const enteredAt = useRef(new Date().toISOString());

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const checkConnection = async () => {
      try {
        const response = await fetch(
          `/api/users/ai-connection-status?since=${encodeURIComponent(enteredAt.current)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;

        const data = (await response.json()) as { connected?: boolean };
        if (!cancelled && data.connected) {
          setConnected(true);
          onConnected();
          if (intervalId) clearInterval(intervalId);
        }
      } catch {
        // Connection confirmation is best-effort; keep polling after transient errors.
      }
    };

    void checkConnection();
    intervalId = setInterval(() => void checkConnection(), 4000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [onConnected]);

  return (
    <div className="flex items-center gap-2 text-content">
      <span
        className={cn(
          "h-2 w-2 flex-shrink-0 rounded-full",
          connected
            ? "bg-green-500"
            : "bg-amber-400 motion-safe:animate-pulse",
        )}
      />
      <span className={connected ? "text-green-500" : "text-text-light-gray"}>
        {connected
          ? `Connected! ${label} just talked to Hypertask.`
          : `Waiting for ${label} to connect…`}
      </span>
    </div>
  );
}

export const ConnectAIOnboardingScreen: React.FC<IConnectAIOnboardingScreen> = ({
  onNextScreen,
}) => {
  const [phase, setPhase] = useState<"choose" | "connect">("choose");
  const [chosenTool, setChosenTool] = useState<ToolChoice | null>(null);
  const [method, setMethod] = useState<ConnectMethod>("mcp");
  const [useBearer, setUseBearer] = useState(false);
  const [connected, setConnected] = useState(false);
  const hasGeneratedToken = useRef(false);
  const { token, expiresAt, isLoading, isGenerating, generateToken } =
    useMcpToken();

  useEffect(() => {
    if (
      phase === "connect" &&
      chosenTool &&
      chosenTool !== "builtin" &&
      !token &&
      !isLoading &&
      !isGenerating &&
      !hasGeneratedToken.current
    ) {
      hasGeneratedToken.current = true;
      void generateToken();
    }
  }, [chosenTool, generateToken, isGenerating, isLoading, phase, token]);

  const handleChooseTool = (tool: ToolChoice) => {
    void fetch("/api/users/onboarding-ai-choice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool }),
    }).catch(() => undefined);

    setChosenTool(tool);
    setMethod(TOOL_METHODS[tool]?.[0] ?? "mcp");
    setConnected(false);
    setPhase("connect");
  };

  const handleChooseDifferentTool = () => {
    setPhase("choose");
    setChosenTool(null);
    setConnected(false);
    setUseBearer(false);
  };

  const handleConnected = useCallback(() => setConnected(true), []);

  const chosenLabel = TOOL_CHOICES.find(
    (choice) => choice.id === chosenTool,
  )?.label;

  if (phase === "choose") {
    return (
      <div className="flex flex-col gap-6 items-center justify-center max-w-[720px] mx-auto px-4 cursor-default">
        <div className="text-center space-y-3">
          <h2 className="text-heading sm:text-display font-semibold text-white-black">
            Which AI will you drive Hypertask with?
          </h2>
          <p className="text-text-light-gray text-emphasis max-w-[560px]">
            You can run your whole board through AI: create tasks, plan your
            week, triage your inbox by chatting. Start with the built-in chat,
            and connect the AI you already use so your board is there too.
          </p>
        </div>

        <div className="w-full space-y-5">
          <button
            type="button"
            onClick={() => handleChooseTool("builtin")}
            className="flex w-full flex-col gap-3 rounded border-thin border-hypertasks-purple bg-comment-description p-4 text-left transition-colors hover:bg-hover-active"
          >
            <span className="flex items-start gap-3">
              <Sparkles
                size={22}
                className="mt-0.5 flex-shrink-0 text-hypertasks-ai-purple"
                aria-hidden
               strokeWidth={1.75}/>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-content font-semibold text-white-black">
                  Hypertask AI, built in
                  <span className="rounded bg-hypertasks-purple px-1.5 py-0.5 text-micro font-medium leading-none text-white">
                    Recommended
                  </span>
                </span>
                <span className="mt-1 block text-meta text-text-light-gray">
                  Chat with your board right here. Nothing to install, it
                  already works.
                </span>
              </span>
            </span>
            <span className="grid grid-cols-1 gap-x-4 gap-y-1 pl-9 sm:grid-cols-2">
              {BUILTIN_USE_CASES.map((useCase) => (
                <UseCaseRow key={useCase} text={useCase} />
              ))}
            </span>
          </button>

          {TOOL_TIERS.map((tier) => (
            <div key={tier.heading}>
              <p className="text-content font-medium text-white-black">
                {tier.heading}
              </p>
              <p className="mb-2 text-meta text-text-light-gray">{tier.blurb}</p>
              <div className="mb-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                {tier.useCases.map((useCase) => (
                  <UseCaseRow key={useCase} text={useCase} />
                ))}
              </div>
              <div
                className={cn(
                  "grid grid-cols-2 gap-2",
                  tier.tools.length > 2 && "sm:grid-cols-4",
                )}
              >
                {tier.tools.map((toolId) => (
                  <button
                    key={toolId}
                    type="button"
                    onClick={() => handleChooseTool(toolId)}
                    className={cn(
                      getIntegrationChipClassName(false),
                      "w-full min-h-12 justify-center text-center",
                    )}
                  >
                    {TOOL_CHOICES.find((choice) => choice.id === toolId)
                      ?.label ?? toolId}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-meta text-text-light-gray">
          Full access free for 14 days. No credit card needed.
        </p>
      </div>
    );
  }

  if (!chosenTool || !chosenLabel) return null;

  const isBuiltin = chosenTool === "builtin";

  return (
    <div className="flex flex-col gap-6 items-center justify-center max-w-[720px] mx-auto px-4 cursor-default">
      <div className="w-full shadow-customshadow-2 bg-comment-description rounded border-thin border-border-light-gray-thin p-4 sm:p-5 text-white-black">
        <button
          type="button"
          onClick={handleChooseDifferentTool}
          className="mb-3 text-meta text-text-light-gray hover:text-white-black hover:underline"
        >
          ← Choose a different tool
        </button>

        <h2 className="mb-4 text-subheading sm:text-heading font-semibold text-white-black">
          {isBuiltin ? "Your built-in AI" : `Connect ${chosenLabel}`}
        </h2>

        {isBuiltin ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-content font-medium text-green-500">
                Nothing to install, already on your board
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex justify-end">
                <div className="max-w-[78%] rounded bg-hypertasks-purple px-3 py-2 text-content text-white">
                  Set up a launch plan for our mobile app
                </div>
              </div>

              <div className="flex justify-start">
                <div className="max-w-[88%] rounded bg-taskDetal-container px-3 py-2 text-content text-white-black">
                  <div className="flex items-start gap-2">
                    <Sparkles
                      size={14}
                      className="mt-0.5 flex-shrink-0 text-hypertasks-ai-purple"
                      aria-hidden
                     strokeWidth={1.75}/>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        Created 8 tasks in 3 sections:
                      </p>
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 flex-shrink-0 rounded-[2px] border-thin border-text-light-gray" />
                          <span className="min-w-0 flex-1 truncate text-meta">
                            Define launch messaging
                          </span>
                          <span className="flex items-center gap-1 text-micro font-medium leading-none text-text-light-gray">
                            <span
                              className="h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: "#DE9D6E" }}
                              aria-hidden
                            />
                            High
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 flex-shrink-0 rounded-[2px] border-thin border-text-light-gray" />
                          <span className="min-w-0 flex-1 truncate text-meta">
                            Set up beta signup flow
                          </span>
                          <span className="flex items-center gap-1 text-micro font-medium leading-none text-text-light-gray">
                            <span
                              className="h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: "#C2CFA5" }}
                              aria-hidden
                            />
                            Medium
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 flex-shrink-0 rounded-[2px] border-thin border-text-light-gray" />
                          <span className="min-w-0 flex-1 truncate text-meta">
                            Draft App Store listing
                          </span>
                          <span className="flex items-center gap-1 text-micro font-medium leading-none text-text-light-gray">
                            <span
                              className="h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: "#95999E" }}
                              aria-hidden
                            />
                            Low
                          </span>
                        </div>
                      </div>
                      <p className="mt-1.5 text-meta text-text-light-gray">
                        …and 5 more
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className={getIntegrationChipClassName(false)}>
                Plan my week
              </span>
              <span className={getIntegrationChipClassName(false)}>
                Summarize my inbox
              </span>
              <span className={getIntegrationChipClassName(false)}>
                Draft tasks from my notes
              </span>
            </div>

            <p className="text-meta text-text-light-gray">
              Opens automatically when you launch · Ctrl+Shift+?
            </p>
          </div>
        ) : (
          <div>
            {(TOOL_METHODS[chosenTool]?.length ?? 0) > 1 && (
              <div className="mb-3 flex gap-1 border-b border-border-light-gray-thin">
                {TOOL_METHODS[chosenTool]?.map((methodOption) => (
                  <button
                    key={methodOption}
                    type="button"
                    onClick={() => setMethod(methodOption)}
                    className={cn(
                      "-mb-px border-b-2 px-3 py-1.5 text-meta font-medium transition-colors",
                      method === methodOption
                        ? "border-hypertasks-purple text-white-black"
                        : "border-transparent text-text-light-gray hover:text-white-black",
                    )}
                  >
                    {METHOD_LABELS[methodOption]}
                  </button>
                ))}
              </div>
            )}

            {method !== "cli" && (
              <TokenStatusBar
                token={token}
                expiresAt={expiresAt}
                isLoading={isLoading}
                isGenerating={isGenerating}
                onGenerate={generateToken}
              />
            )}

            {method === "cli" && (
              <div className="mt-3 rounded border-thin border-border-light-gray-thin bg-cardBackground p-4">
                <h4 className="mb-2 text-content font-medium text-white-black">
                  Use the Hypertask CLI in {chosenLabel}
                </h4>
                <p className="mb-2 text-meta text-text-light-gray">
                  Run these in your terminal. <code>hypertask login</code>{" "}
                  opens your browser to authorize. Then tell {chosenLabel} to
                  use the <code>hypertask</code> command.
                </p>
                <CopyableCodeBlock
                  value={`${INSTALL_COMMAND}\n${LOGIN_COMMAND}`}
                />
              </div>
            )}

            {method === "mcp" && (
              <ConnectInstructions
                integrationId={chosenTool}
                token={token}
                useBearer={useBearer}
                onUseBearerClick={() => setUseBearer((value) => !value)}
              />
            )}

            {method === "rest" && (
              <div className="mt-3 rounded border-thin border-border-light-gray-thin bg-cardBackground p-4">
                <h4 className="mb-2 text-content font-medium text-white-black">
                  Call the REST API directly
                </h4>
                <p className="mb-2 text-meta text-text-light-gray">
                  Give {chosenLabel} your token and the base URL. Every MCP
                  tool is also a plain REST endpoint under{" "}
                  <code>/api/mcp/*</code>. Try it:
                </p>
                <CopyableCodeBlock
                  value={`curl ${REST_BASE_URL}/api/mcp/user/context \\\n  -H "Authorization: Bearer ${token && token !== "***" ? token : "<your-token>"}"`}
                  errorMessage={
                    token && token !== "***"
                      ? undefined
                      : "Please generate a token first"
                  }
                />
              </div>
            )}

            <p className="mt-3 text-meta text-text-light-gray">
              {method === "cli"
                ? "Logging in from the CLI confirms the connection automatically."
                : 'Ask your AI something about your board, e.g. "What’s on my Hypertask board?"'}
            </p>

            <div className="mt-4">
              <ConnectionStatus
                label={chosenLabel}
                onConnected={handleConnected}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-2">
        <GetStartedButton
          onClick={onNextScreen}
          text="Continue"
          disabled={!isBuiltin && !connected}
        />
        {!isBuiltin && (
          <button
            type="button"
            onClick={onNextScreen}
            className="text-meta text-text-light-gray hover:text-white-black hover:underline"
          >
            I&apos;ll connect later, skip this step
          </button>
        )}
      </div>
    </div>
  );
};
