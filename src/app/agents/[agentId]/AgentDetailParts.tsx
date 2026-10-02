"use client";

import type { RuntimeStateKey } from "./runtimeStateKey";
import { cn } from "@/utils/undoActions/helperFuncs";
import Link from "next/link";
import type { TAgent } from "../AgentsRegister";
import { TActivityItem } from "./agentDetailTypes";

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

export function elapsedSince(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export const healthLabel: Record<RuntimeStateKey, string> = {
  working: "Working",
  connected: "Connected",
  waiting: "Waiting",
  stalled: "Stalled",
  offline: "Offline",
  on_demand: "On demand",
};

export const healthDotClass: Record<RuntimeStateKey, string> = {
  working: "bg-hypertasks-green",
  connected: "bg-hypertasks-green",
  waiting: "bg-amber-400",
  stalled: "bg-red-400",
  offline: "bg-gray-500",
  on_demand: "bg-[var(--color-text-light-gray)]",
};

export const queueReasonLabel = {
  direct_mention: "Direct mention",
  assignment: "Assigned",
  discovery: "Discovery candidate",
  other: "Queued",
} as const;

// Must read the same two signals the register card reads, or the same agent
// reports "Running" on the grid and "Quiet" on its own page.
export function statusWord(agent: TAgent): string {
  if (agent.revokedAt) return "Off";
  const last = [agent.heartbeatAt, agent.lastPostedAt].filter(
    (t): t is string => Boolean(t),
  );
  const latest =
    last.length > 0 ? last.reduce((a, b) => (b > a ? b : a)) : null;
  if (latest && Date.now() - new Date(latest).getTime() < 24 * 60 * 60 * 1000) {
    return "Running";
  }
  return "Quiet";
}

export const statusDotClass: Record<string, string> = {
  Running: "bg-green-500",
  Quiet: "bg-gray-400",
  Off: "bg-gray-500 opacity-50",
};

export function AgentSwitch({
  on,
  displayName,
  onToggle,
  pending,
  ariaLabel,
}: {
  on: boolean;
  displayName: string;
  onToggle: () => void;
  pending: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={
        ariaLabel ?? (on ? `Turn off ${displayName}` : `Turn on ${displayName}`)
      }
      aria-pressed={on}
      disabled={pending}
      onClick={onToggle}
      className={cn(
        "relative w-[30px] h-[17px] rounded-full shrink-0 transition-colors",
        on ? "bg-hypertasks-purple" : "bg-hoverCardBackground",
        pending && "opacity-60",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] left-[2px] w-[13px] h-[13px] rounded-full bg-white transition-transform",
          on && "translate-x-[13px]",
        )}
      />
    </button>
  );
}


export function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline text-[13px]">
      <span className="w-[27%] shrink-0 text-text-light-gray font-medium">
        {label}
      </span>
      <span className="ml-[14px] min-w-0">{children}</span>
    </div>
  );
}

export function RecentActionsCard({
  activity,
  error,
  showTokenUsage,
  embedded,
}: {
  activity: TActivityItem[] | null;
  error: string | null;
  showTokenUsage: boolean;
  embedded?: boolean;
}) {
  return (
    <div className="mt-3 bg-cardBackground rounded-[4px] p-4 shadow-md overflow-x-auto">
      <h2 className="font-semibold mb-2">Recent actions</h2>
      {error && <p className="text-[13px] text-red-500">{error}</p>}
      {!error && !activity && (
        <p className="text-[13px] text-text-light-gray">Loading activity…</p>
      )}
      {!error && activity?.length === 0 && (
        <p className="text-[13px] text-text-light-gray">No activity yet.</p>
      )}
      {!error && activity && activity.length > 0 && (
        <table
          className={cn("w-full text-left", !embedded && "min-w-[560px]")}
        >
          <thead>
            <tr>
              {["When", "Did", "Where"].map((heading) => (
                <th
                  key={heading}
                  className="text-[12px] uppercase text-text-light-gray font-medium pb-2 pr-3"
                >
                  {heading}
                </th>
              ))}
              {showTokenUsage && (
                <th className="text-[12px] uppercase text-text-light-gray font-medium pb-2">
                  Tokens
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {activity.map((item) => (
              <tr
                key={item.id}
                className="border-t border-comment-description-border"
              >
                <td className="text-[13px] py-2 pr-3 whitespace-nowrap text-text-light-gray">
                  {timeAgo(item.at)}
                </td>
                <td className="text-[13px] py-2 pr-3">
                  <div>{item.did}</div>
                  {item.detail && (
                    <div className="text-[12px] text-text-light-gray truncate max-w-[280px]">
                      {item.detail}
                    </div>
                  )}
                </td>
                <td className="text-[13px] py-2 pr-3 max-w-[180px]">
                  {item.task ? (
                    <Link
                      href={item.task.url}
                      className="text-hypertasks-purple truncate block"
                    >
                      {item.task.title}
                    </Link>
                  ) : (
                    <span className="text-text-light-gray">—</span>
                  )}
                </td>
                {showTokenUsage && (
                  <td className="text-[13px] py-2">
                    {item.tokens != null ? (
                      formatTokens(item.tokens)
                    ) : (
                      <span className="text-text-light-gray">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
