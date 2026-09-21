import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/utils/undoActions/helperFuncs";
import { Activity as ActivityIcon, ChevronDown, CircleAlert, CircleHelp, ExternalLink, Lightbulb, Ticket as TicketIcon } from "lucide-react";
import { markdownToHtml } from "@/utils/helperFunctions/markdownToHtml";
import { wrapTablesInMessageHtml, interceptMessageLinkClick } from "@/utils/helperFunctions/messageHtmlLinks";
import formatDateDifference from "@/utils/generateTime";
import { chatRosterStatus, isWorking, statusOf, type TChatRosterStatus } from "@/lib/agents/registerView";
import { tokenizeMessageLinks, type TProjectIdForPrefix } from "@/lib/agents/messageLinks";
import type { TAgent } from "@/app/agents/AgentsRegister";
import AgentAvatar from "@/components/Agents/AgentAvatar";
import { useFlag } from "@/hooks/useFlag";
import { CONFIRMED_PROPOSAL_HEADING_FLAG } from "@/lib/flags/keys";
import { type AgentChatActivity, type AgentChatActivityGroup, type AgentChatFilter } from "@/lib/agents/chatActivityFeed";
import { PROPOSAL_HEADING_CREATED, PROPOSAL_HEADING_PENDING, type SerializedChatTicketProposal } from "@/lib/agents/chatTicketProposal";

export type TChatMessage = {
  id: string;
  role: "human" | "assistant" | "system";
  content: string;
  createdAt: string;
  proposal?: SerializedChatTicketProposal | null;
};

export type TProposalAction = (
  proposalId: string,
  action: "confirm" | "dismiss",
) => Promise<void>;

export function rosterDotClass(agent: TAgent): string {
  return statusOf(agent) === "running" ? "bg-green-500" : "bg-gray-400";
}

export const rosterStatusDotClass: Record<TChatRosterStatus["kind"], string> = {
  active: "bg-green-500",
  "out-of-tokens": "bg-amber-500",
  idle: "bg-gray-400",
  inactive: "bg-gray-500 opacity-50",
};

export function rosterIdleFor(since: string, now: number): string {
  const min = Math.floor((now - new Date(since).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function rosterStatusLine(agent: TAgent, status: TChatRosterStatus, now: number): string {
  const type = agent.runtimeType === "EXTERNAL" ? "External" : "Native";
  switch (status.kind) {
    case "active":
      return agent.working ? `${type} · ${agent.working.ticket}` : type;
    case "out-of-tokens":
      return `${type} · Out of tokens`;
    case "idle":
      return `${type} · Idle ${rosterIdleFor(status.since, now)}`;
    case "inactive":
      return `${type} · Inactive`;
  }
}

export const MARKDOWN_CLASS =
  "break-words [&_p]:my-2 [&_p]:leading-relaxed [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_a]:text-hypertasks-purple [&_a]:underline [&_a]:break-all " +
  "[&_code]:bg-hoverCardBackground [&_code]:rounded-[3px] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-meta " +
  "[&_pre]:bg-hoverCardBackground [&_pre]:rounded-[4px] [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0";

export function ProposalCard({
  proposal,
  onAction,
}: {
  proposal: SerializedChatTicketProposal;
  onAction?: TProposalAction;
}) {
  const [busy, setBusy] = useState<"confirm" | "dismiss" | null>(null);
  const run = async (action: "confirm" | "dismiss") => {
    if (!onAction || busy) return;
    setBusy(action);
    try {
      await onAction(proposal.id, action);
    } finally {
      setBusy(null);
    }
  };
  const open = proposal.status === "PENDING" || proposal.status === "FAILED";
  const confirmedHeadingEnabled = useFlag(CONFIRMED_PROPOSAL_HEADING_FLAG);
  const confirmLabel = busy === "confirm" ? "Creating…" : "Create ticket";
  return (
    <div className="mt-1 max-w-[80%] rounded-[5px] bg-cardBackground px-3 py-2 text-meta">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-white-black">
        <TicketIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span>
          {confirmedHeadingEnabled &&
          proposal.status === "CONFIRMED" &&
          proposal.task
            ? PROPOSAL_HEADING_CREATED
            : PROPOSAL_HEADING_PENDING}
        </span>
      </div>
      <p className="text-white-black">{proposal.ticketTitle}</p>
      <p className="text-text-light-gray">{proposal.outcome}</p>
      <p className="mt-1 text-text-light-gray">
        {proposal.targetProjectTitle} · {proposal.targetSectionTitle}
      </p>
      {proposal.status === "FAILED" && proposal.failureMessage && (
        <p className="mt-1 text-red-500">{proposal.failureMessage}</p>
      )}
      {proposal.status === "CONFIRMED" && !proposal.task && (
        <p className="mt-1 text-text-light-gray">Creating the ticket…</p>
      )}
      {proposal.status === "CONFIRMED" &&
        proposal.task &&
        (proposal.task.url ? (
          <a
            href={proposal.task.url}
            className="mt-1 inline-flex items-center gap-1 text-hypertasks-purple hover:underline"
          >
            {proposal.task.ticketNumber}
            <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.75} />
          </a>
        ) : (
          <p className="mt-1 text-text-light-gray">
            {proposal.task.ticketNumber} was deleted.
          </p>
        ))}
      {proposal.status === "DISMISSED" && (
        <p className="mt-1 text-text-light-gray">Dismissed, still discussing.</p>
      )}
      {open && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("dismiss")}
            className="text-dense text-text-light-gray hover:text-white-black disabled:opacity-50"
          >
            Keep discussing
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("confirm")}
            className="rounded-[4px] bg-shadcn-primary px-3 py-1.5 text-dense font-medium text-primary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {proposal.status === "FAILED" && busy === null
              ? "Try again"
              : confirmLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function MessageBubble({
  message,
  projectIdForPrefix,
  onProposalAction,
  pending = false,
}: {
  message: TChatMessage;
  projectIdForPrefix: TProjectIdForPrefix;
  onProposalAction?: TProposalAction;
  /** Optimistic bubble whose POST is still in flight. */
  pending?: boolean;
}) {
  const router = useRouter();
  const isHuman = message.role === "human";
  if (message.role === "system") {
    return (
      <p className="text-meta text-text-light-gray">{message.content}</p>
    );
  }
  // Always on: a hover-only timestamp is unreadable on touch and invisible to
  // a screen reader, and a message with no state at all reads as untrustworthy
  // (HTPR-6005 QA).
  const timestamp = (
    <div
      className={cn(
        "mt-0.5 text-[10px] text-text-light-gray",
        isHuman ? "text-right" : "text-left",
      )}
    >
      {pending ? (
        <span>Sending…</span>
      ) : (
        <time
          dateTime={message.createdAt}
          title={new Date(message.createdAt).toLocaleString()}
        >
          {formatDateDifference(new Date(message.createdAt))}
        </time>
      )}
    </div>
  );
  if (isHuman) {
    return (
      <div className="group/msg flex flex-col items-end">
        <div className="max-w-[80%] rounded-[4px] bg-shadcn-primary px-3 py-2 text-dense text-primary-foreground whitespace-pre-wrap break-words">
          {tokenizeMessageLinks(message.content, projectIdForPrefix).map(
            (segment, i) =>
              segment.type === "link" ? (
                <a
                  key={i}
                  href={segment.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {segment.value}
                </a>
              ) : (
                <span key={i}>{segment.value}</span>
              ),
          )}
        </div>
        {timestamp}
      </div>
    );
  }
  // markdownToHtml escapes raw HTML and sanitizes the result, so the string is
  // safe to inject.
  return (
    <div className="group/msg flex flex-col items-start">
      <div
        className={cn(
          "max-w-[80%] rounded-[4px] bg-cardBackground px-3 py-2 text-dense",
          MARKDOWN_CLASS,
        )}
        onClick={(e) => interceptMessageLinkClick(e, router)}
        dangerouslySetInnerHTML={{
          __html: wrapTablesInMessageHtml(markdownToHtml(message.content)),
        }}
      />
      {message.proposal && (
        <ProposalCard
          proposal={message.proposal}
          onAction={onProposalAction}
        />
      )}
      {timestamp}
    </div>
  );
}

export const ACTIVITY_ICONS: Record<
  AgentChatActivity["type"],
  typeof ActivityIcon
> = {
  thought: Lightbulb,
  action: ActivityIcon,
  error: CircleAlert,
  elicitation: CircleHelp,
};

export function ActivityGroup({
  group,
  constrainRows,
}: {
  group: AgentChatActivityGroup;
  constrainRows?: boolean;
}) {
  const label = group.task
    ? `${group.task.ticketNumber}: ${group.task.title}`
    : "Agent activity";
  return (
    <div
      className="rounded-[5px] bg-cardBackground px-3 py-2 text-meta text-text-light-gray"
      role="group"
      aria-label={label}
    >
      <div className="mb-1 flex min-w-0 items-center gap-1.5 font-medium">
        <ActivityIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        {group.task ? (
          <a
            href={group.task.url}
            className="min-w-0 truncate text-white-black hover:text-hypertasks-purple"
            title={label}
          >
            {group.task.ticketNumber} · {group.task.title}
          </a>
        ) : (
          <span className="text-white-black">Agent activity</span>
        )}
      </div>
      <div className="space-y-1">
        {group.events.map((event) => {
          const Icon = ACTIVITY_ICONS[event.type];
          const eventContent = event.link ? (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "min-w-0 items-center gap-1 text-white-black hover:text-hypertasks-purple",
                constrainRows
                  ? "flex w-full max-w-full"
                  : "inline-flex",
              )}
            >
              <span className="truncate">{event.text}</span>
              <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            </a>
          ) : (
            <span
              className={cn(
                "min-w-0 truncate",
                constrainRows && "block w-full",
              )}
            >
              {event.text}
            </span>
          );
          return (
            <div key={event.id} className="flex min-w-0 items-center gap-1.5">
              <Icon
                className={cn(
                  "h-3 w-3 shrink-0",
                  event.type === "error" && "text-red-500",
                )}
                strokeWidth={1.75}
                aria-hidden
              />
              {constrainRows ? (
                <div className="min-w-0 flex-1">{eventContent}</div>
              ) : (
                eventContent
              )}
              <time
                dateTime={event.createdAt}
                className="ml-auto shrink-0 text-micro"
                title={new Date(event.createdAt).toLocaleString()}
              >
                {formatDateDifference(new Date(event.createdAt))}
              </time>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FeedFilter({
  value,
  onChange,
}: {
  value: AgentChatFilter;
  onChange: (value: AgentChatFilter) => void;
}) {
  const options: { value: AgentChatFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "chat", label: "Chat only" },
    { value: "activity", label: "Activity only" },
  ];
  return (
    <div
      className="flex w-fit rounded-[4px] bg-hoverCardBackground p-0.5"
      role="group"
      aria-label="Filter Agent Chat feed"
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-sm px-2 py-1 text-meta transition-colors",
              active
                ? "bg-cardBackground text-white-black shadow-sm"
                : "text-text-light-gray hover:text-white-black",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ScrollToBottomButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to latest messages"
      className={cn(
        "absolute left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-active-elementBg shadow-md",
        className ?? "top-2",
      )}
    >
      <ChevronDown size={18} strokeWidth={1.75} />
    </button>
  );
}

export function RosterRow({
  agent,
  selected,
  onSelect,
  now,
}: {
  agent: TAgent;
  selected: boolean;
  onSelect: (agent: TAgent) => void;
  now: number;
}) {
  const statusViewEnabled = useFlag("htpr-6287-agent-chat-roster-status");
  const status = statusViewEnabled ? chatRosterStatus(agent, now) : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(agent)}
      aria-pressed={selected}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 rounded-[4px] text-left transition-colors",
        selected ? "bg-hoverCardBackground" : "hover:bg-hoverCardBackground",
      )}
    >
      <AgentAvatar agentId={agent.id} name={agent.displayName} photoURL={agent.photoURL} size={28} className="text-[11px]" />
      <span
        className={cn(
          "w-2 h-2 rounded-full shrink-0",
          status ? rosterStatusDotClass[status.kind] : rosterDotClass(agent),
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-dense font-medium truncate">
          {agent.displayName}
        </span>
        <span className="block text-[11px] text-text-light-gray truncate">
          {status ? (
            rosterStatusLine(agent, status, now)
          ) : (
            <>
              {agent.runtimeType === "EXTERNAL" ? "External" : "Native"}
              {isWorking(agent) && agent.working ? ` · ${agent.working.ticket}` : ""}
            </>
          )}
        </span>
      </span>
      {/* The thread is shared, so a teammate's message is news to this person
          too. Hidden while the chat is open, because reading it is catching
          up and the count is about to be zero. */}
      {!selected && (agent.unreadCount ?? 0) > 0 && (
        <span
          aria-label={`${agent.unreadCount} unread`}
          className="shrink-0 rounded-full bg-shadcn-primary px-1.5 py-0.5 text-micro font-semibold leading-none text-primary-foreground"
        >
          {agent.unreadCount! > 99 ? "99+" : agent.unreadCount}
        </span>
      )}
    </button>
  );
}

export function chatStatusText(agent: TAgent): string {
  if (isWorking(agent) && agent.working) {
    return `Working on ${agent.working.ticket}`;
  }
  return "Idle";
}

export function emptyFeedText(filter: AgentChatFilter, agentName: string): string {
  if (filter === "activity") return "No activity yet.";
  if (filter === "chat") return "No chat messages yet.";
  return `Send ${agentName} a message to start the conversation.`;
}
