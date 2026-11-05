"use client";

import {
  Activity as ActivityIcon,
  CircleAlert,
  CircleHelp,
  ExternalLink,
  Lightbulb,
} from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";

import RelativeTime from "@/components/Common/RelativeTime";
import CommentBodyDesktop from "./CommentContainer/CommentBodyDesktop";
import styles from "@/styles/tiptap.module.scss";
import { useFlag } from "@/hooks/useFlag";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import type { SerializedAgentRunActivity } from "@/lib/agentRuns/model";
import { safeAgentRunActivityLink } from "@/lib/agentRuns/taskActivityFeed";
import { HTPR_8262_AGENT_LANE_COLLAPSE_FLAG } from "@/lib/flags/definitions/htpr-8262-agent-lane-collapse";
import { HTPR_8846_AGENT_LANE_ON_READABLE_BOARD_FLAG } from "@/lib/flags/definitions/htpr-8846-agent-lane-on-readable-board";
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
  const collapseLane = useFlag(HTPR_8262_AGENT_LANE_COLLAPSE_FLAG);
  const showLaneAuthor = useFlag(HTPR_8846_AGENT_LANE_ON_READABLE_BOARD_FLAG);
  const { agentLaneFold } = useTaskContext();
  const laneCollapsed = agentLaneFold.taskId === taskId && agentLaneFold.collapsed;
  const [override, setOverride] = useState<{ version: number; taskId: number; collapsed: boolean } | null>(null);

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
  const laneAuthor = showLaneAuthor && activity.agentName ? (
    <span className="shrink-0">{activity.agentName}</span>
  ) : null;
  const Icon = collapseLane ? Lightbulb : ACTIVITY_ICONS[type];
  const icon = (
    <Icon
      className={cn(
        collapseLane ? "h-3.5 w-3.5 shrink-0" : "mt-0.5 h-3 w-3 shrink-0",
        !collapseLane && type === "error" && "text-destructive",
      )}
      strokeWidth={1.75}
      aria-hidden
    />
  );
  const link = safeAgentRunActivityLink(activity.link);
  const linkIcon = (
    <ExternalLink
      className={cn(
        "mt-0.5 h-3 w-3 shrink-0",
        collapseLane && "opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100",
      )}
      strokeWidth={1.75}
      aria-hidden
    />
  );
  const collapsible = collapseLane;
  const collapsed = collapsible && (override?.version === agentLaneFold.version && override.taskId === taskId ? override.collapsed : laneCollapsed);
  const toggleRow = () => {
    if (!collapsible) return;
    setOverride({ version: agentLaneFold.version, taskId, collapsed: !collapsed });
  };
  const rowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleRow();
  };

  const time = (
    <time
      dateTime={activity.createdAt}
      className="ml-auto shrink-0 text-micro"
      title={new Date(activity.createdAt).toLocaleString()}
    >
      <RelativeTime date={activity.createdAt} />
    </time>
  );

  if (collapsed) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-expanded={false}
        aria-label={`Agent ${activity.type}, collapsed`}
        data-agent-lane-corners=""
        onClick={toggleRow}
        onKeyDown={rowKeyDown}
        className="my-[4px] flex h-[29px] min-w-0 cursor-pointer items-center gap-2 rounded-[4px] border-l-4 border-transparent px-4 py-1 text-content text-text-light-gray outline-none hover:bg-active-elementBg focus-visible:bg-hover-active focus-visible:text-white-black"
      >
        {icon}
        {laneAuthor}
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {activity.text}
        </span>
        {time}
      </div>
    );
  }

  const openRowProps = collapsible
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-label": `Agent ${activity.type}`,
        "aria-expanded": true,
        onClick: toggleRow,
        onKeyDown: rowKeyDown,
      }
    : { role: "group" as const, "aria-label": `Agent ${activity.type}` };

  if (collapseLane) {
    return (
      <div
        className="my-[8px] cursor-pointer rounded-[4px] border-l-4 border-transparent bg-comment-description shadow-md outline-none focus-visible:bg-hover-active"
        data-agent-lane-corners=""
        {...(activity.type === "elicitation"
          ? { role: "group" as const, "aria-label": `Agent ${activity.type}`, onClick: toggleRow }
          : openRowProps)}
      >
        <CommentBodyDesktop isStacked={false} threadSpacing>
          <div
            className={cn(
              "flex items-center gap-2 text-meta text-text-light-gray",
              styles.unstacked_grid_row1,
              activity.type === "elicitation" && "outline-none focus-visible:bg-hover-active",
            )}
            {...(activity.type === "elicitation" ? {
              ...openRowProps,
              onClick: (event: React.MouseEvent<HTMLDivElement>) => {
                event.stopPropagation();
                toggleRow();
              },
            } : {})}
          >
            {icon}
            <span>Agent</span>
            {time}
          </div>
          <div
            className={cn(
              "min-w-0 whitespace-pre-wrap break-words text-text-light-gray",
              styles.unstacked_grid_row2,
            )}
          >
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="group/link inline-flex items-start gap-1 hover:text-white-black"
              >
                <span>{activity.text}</span>
                {linkIcon}
              </a>
            ) : activity.text}
            {activity.type === "elicitation" && activity.options ? (
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Choose a response">
                {activity.options.map((option) => {
                  const selected = activity.selectedOption?.value === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      aria-disabled={selectionLocked}
                      aria-busy={pendingValue === option.value || undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        void selectOption(option.value);
                      }}
                      className={cn(
                        "min-h-11 min-w-11 rounded-[4px] px-3 py-2 text-dense font-medium transition-colors focus-visible:outline-none focus-visible:bg-hover-active focus-visible:text-white-black",
                        selected
                          ? "bg-white-black text-white-black-inverted"
                          : "bg-hoverCardBackground text-white-black hover:bg-hover-active",
                        selectionLocked && !selected && "opacity-50",
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
        </CommentBodyDesktop>
      </div>
    );
  }

  return (
    <div
      className={cn(
        collapseLane ? "my-[8px]" : "px-3 py-1",
        collapsible &&
          "cursor-pointer outline-none focus-visible:bg-hover-active focus-visible:text-white-black",
      )}
      {...openRowProps}
    >
      <div
        className={cn(
          "rounded-[5px] bg-cardBackground text-meta text-text-light-gray",
          collapseLane ? "px-4 py-5" : "px-3 py-2",
        )}
      >
        <div className="flex min-w-0 items-start gap-1.5">
          {icon}
          {laneAuthor}
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="inline-flex min-w-0 items-start gap-1 text-white-black hover:text-hypertasks-purple"
            >
              <span className="break-words">{activity.text}</span>
              {linkIcon}
            </a>
          ) : (
            <span className="min-w-0 break-words">{activity.text}</span>
          )}
          {time}
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
                  onClick={(event) => {
                    event.stopPropagation();
                    void selectOption(option.value);
                  }}
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
