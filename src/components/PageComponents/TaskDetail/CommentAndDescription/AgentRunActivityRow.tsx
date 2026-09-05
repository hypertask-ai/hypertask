"use client";

import {
  Activity as ActivityIcon,
  CircleAlert,
  CircleHelp,
  ExternalLink,
  Lightbulb,
} from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";

import RelativeTime from "@/components/Common/RelativeTime";
import type { SerializedAgentRunActivity } from "@/lib/agentRuns/model";
import { refreshTaskComments } from "@/lib/realtime/taskCommentsRefresh";
import { cn } from "@/utils/undoActions/helperFuncs";

const ACTIVITY_ICONS = {
  thought: Lightbulb,
  action: ActivityIcon,
  error: CircleAlert,
  elicitation: CircleHelp,
} as const;

const AgentRunActivityRow = ({
  activity,
  taskId,
}: {
  activity: SerializedAgentRunActivity;
  taskId: number;
}) => {
  const queryClient = useQueryClient();
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const selectionLocked = activity.selectedOption !== null || pendingValue !== null;

  const selectOption = async (value: string) => {
    if (selectionLocked) return;
    setPendingValue(value);
    try {
      const response = await fetch(
        `/api/mcp/agents/runs/${encodeURIComponent(activity.runId)}/activities/${encodeURIComponent(activity.id)}/select`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) {
          await refreshTaskComments(queryClient, taskId);
        }
        throw new Error(payload?.error || "Unable to select this option");
      }
      await refreshTaskComments(queryClient, taskId);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to select this option",
      );
    } finally {
      setPendingValue(null);
    }
  };

  const type = activity.type;
  if (type === "response") return null;
  const Icon = ACTIVITY_ICONS[type];

  return (
    <div className="px-3 py-1">
      <div
        className="rounded-[4px] bg-cardBackground px-3 py-2 text-meta text-text-light-gray"
        role="group"
        aria-label={`Agent ${activity.type}`}
      >
        <div className="flex min-w-0 items-start gap-1.5">
          <Icon
            className={cn(
              "mt-0.5 h-3 w-3 shrink-0",
              activity.type === "error" && "text-red-500",
            )}
            strokeWidth={1.75}
            aria-hidden
          />
          {activity.link ? (
            <a
              href={activity.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-start gap-1 text-white-black hover:text-hypertasks-purple"
            >
              <span className="break-words">{activity.text}</span>
              <ExternalLink
                className="mt-0.5 h-3 w-3 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
            </a>
          ) : (
            <span className="min-w-0 break-words">{activity.text}</span>
          )}
          <time
            dateTime={activity.createdAt}
            className="ml-auto shrink-0 text-[10px]"
            title={new Date(activity.createdAt).toLocaleString()}
          >
            <RelativeTime date={activity.createdAt} />
          </time>
        </div>

        {activity.type === "elicitation" && activity.options ? (
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="group"
            aria-label="Choose a response"
          >
            {activity.options.map((option) => {
              const selected = activity.selectedOption?.value === option.value;
              const blocked = selectionLocked;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  aria-disabled={blocked}
                  aria-busy={pendingValue === option.value || undefined}
                  onClick={() => void selectOption(option.value)}
                  className={cn(
                    "min-h-11 min-w-11 rounded-[4px] px-3 py-2 text-dense font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white-black",
                    selected
                      ? "bg-hypertasks-purple text-white"
                      : "bg-hoverCardBackground text-white-black hover:bg-hover-active",
                    blocked && !selected && "opacity-50",
                    pendingValue === option.value && "cursor-wait",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AgentRunActivityRow;
