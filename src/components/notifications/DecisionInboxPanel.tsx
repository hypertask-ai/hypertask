"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7072_DECISION_INBOX_FLAG } from "@/lib/flags/keys";
import { DECISION_INBOX_COLLAPSED_ROWS, visibleDecisionRows } from "./visibleDecisionRows";

type DecisionRow = {
  kind: "question" | "review" | "flag";
  taskId: number | null;
  ticketKey: string | null;
  title: string;
  question: string;
  waitingSince: string;
  href: string;
};

const waitedFor = (iso: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
};

/**
 * HTPR-7072: everything waiting on the signed-in person's decision. Rows come
 * from ticket state on the server, so answering on the ticket clears the row.
 */
const DecisionInboxPanel = ({ userId }: { userId: number }) => {
  const [expanded, setExpanded] = useState(false);
  const enabled = useFlag(HTPR_7072_DECISION_INBOX_FLAG);
  const { data } = useQuery({
    queryKey: ["inbox", "decisions", userId],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<DecisionRow[]> => {
      const response = await fetch("/api/inbox/decisions", { credentials: "same-origin" });
      if (!response.ok) return [];
      return (await response.json()).rows ?? [];
    },
  });

  if (!enabled || !data?.length) return null;

  return (
    <section
      data-testid="decision-inbox"
      aria-label="Decisions waiting on you"
      className="relative z-20 w-full px-4 py-2 bg-hoverCardBackground"
    >
      <h2 className="text-micro font-normal text-text-light-gray pb-1">
        Decisions ({data.length})
      </h2>
      <ul className="flex flex-col">
        {visibleDecisionRows(data, expanded).map((row) => (
          <li key={`${row.kind}-${row.taskId ?? row.title}`} className="py-1">
            <Link href={row.href} className="block min-w-0">
              <span className="block truncate text-content">
                {row.ticketKey ? `${row.ticketKey} | ` : ""}
                {row.title}
              </span>
              <span className="block truncate text-micro text-text-light-gray">
                {row.question} · waiting {waitedFor(row.waitingSince)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {data.length > DECISION_INBOX_COLLAPSED_ROWS && (
        <button
          type="button"
          data-testid="decision-inbox-toggle"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 py-1 text-micro font-medium text-white-black hover:text-text-light-gray transition-colors"
        >
          {expanded ? "Show fewer" : `Show all (${data.length})`}
        </button>
      )}
    </section>
  );
};

export default DecisionInboxPanel;
