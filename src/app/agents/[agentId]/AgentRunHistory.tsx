"use client";

import { cn } from "@/utils/undoActions/helperFuncs";
import Link from "next/link";
import { elapsedSince, queueReasonLabel } from "./AgentDetailParts";
import type { useAgentBoardAccess } from "./useAgentBoardAccess";
import type { useAgentDetailState } from "./useAgentDetailState";

type Props = Pick<
  ReturnType<typeof useAgentBoardAccess>,
  | "workingNowDot"
  | "workingNowLabel"
  | "activeWork"
  | "runtimeSnapshot"
  | "pendingQueue"
  | "visiblePending"
> &
  Pick<
  ReturnType<typeof useAgentDetailState>,
  | "now"
  | "embedded"
> &
  { agent: NonNullable<ReturnType<typeof useAgentDetailState>["agent"]> };

export function AgentRunHistory({
  workingNowDot, workingNowLabel, activeWork, now, agent, embedded, runtimeSnapshot, pendingQueue,
  visiblePending,
}: Props) {
  return (
    <>
                <section className="bg-cardBackground rounded-[4px] p-4 shadow-md mb-3">
                  <div className="flex items-center gap-3">
                    <h2 className="font-semibold">Working now</h2>
                    <span className="flex items-center gap-1.5 text-[13px] font-medium">
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          workingNowDot,
                        )}
                      />
                      {workingNowLabel}
                    </span>
                    <span className="ml-auto text-[12px] text-text-light-gray">
                      {activeWork
                        ? `${elapsedSince(activeWork.startedAt, now)} elapsed`
                        : "No active ticket"}
                    </span>
                  </div>
                  {activeWork ? (
                    <>
                      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <Link
                          href={activeWork.url}
                          className="text-hypertasks-purple whitespace-nowrap"
                        >
                          {activeWork.ticket}
                        </Link>
                        <strong className="text-[16px]">{activeWork.title}</strong>
                      </div>
                      <p className="mt-1 text-[13px] text-text-light-gray">
                        {activeWork.boardName} · {activeWork.section || "Current stage"}
                        {agent.operations.source === "inferred" &&
                          " · inferred from board"}
                      </p>
                      <div
                        className={cn(
                          "mt-3 grid grid-cols-2 gap-2",
                          !embedded && "sm:grid-cols-4",
                        )}
                      >
                        {[
                          [runtimeSnapshot?.runtime ?? "Unreported", "runtime"],
                          [runtimeSnapshot?.model ?? "Unreported", "model"],
                          [
                            runtimeSnapshot?.heartbeatAt
                              ? `${elapsedSince(runtimeSnapshot.heartbeatAt, now)} ago`
                              : "Never",
                            "heartbeat",
                          ],
                          [
                            runtimeSnapshot?.lastProgressAt
                              ? `${elapsedSince(runtimeSnapshot.lastProgressAt, now)} ago`
                              : "Unreported",
                            "last progress",
                          ],
                        ].map(([value, label]) => (
                          <div
                            key={label}
                            className="bg-newcomment-well rounded-[4px] px-3 py-2 min-w-0"
                          >
                            <strong className="block truncate">{value}</strong>
                            <span className="text-[12px] text-text-light-gray">
                              {label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="mt-2 text-[13px] text-text-light-gray">
                      {agent.operations.source === "runtime"
                        ? "The worker reports no active ticket."
                        : "No active ticket is visible. This status is inferred from the board."}
                    </p>
                  )}
                </section>

                <section className="bg-cardBackground rounded-[4px] p-4 shadow-md mb-3">
                  <div className="flex items-baseline gap-2 mb-3">
                    <h2 className="font-semibold">Queue</h2>
                    <span className="ml-auto text-[12px] text-text-light-gray">
                      {agent.operations.source === "runtime"
                        ? "actual worker order"
                        : "inferred from board"}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "grid grid-cols-2 gap-px bg-comment-description-border rounded-[4px] overflow-hidden",
                      !embedded && "sm:grid-cols-3 lg:grid-cols-6",
                    )}
                  >
                    {[
                      [
                        agent.operations.counts.eligiblePool ?? "—",
                        "scoped pool",
                      ],
                      [agent.operations.counts.workerQueue, "worker queue"],
                      [agent.operations.counts.assigned, "assigned"],
                      [agent.operations.counts.unowned, "unowned"],
                      [agent.operations.counts.specialistOwned, "specialist-owned"],
                      [agent.operations.counts.directMentions, "direct mentions"],
                    ].map(([value, label]) => (
                      <div key={label} className="bg-newcomment-well px-3 py-2.5">
                        <strong className="block text-[18px] font-semibold">
                          {value}
                        </strong>
                        <span className="text-[12px] text-text-light-gray">
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                  {agent.operations.sourceBreakdown.length > 0 && (
                    <p className="mt-2 text-[12px] text-text-light-gray">
                      {agent.operations.sourceBreakdown
                        .map(({ section, eligible }) => `${section} ${eligible}`)
                        .join(" · ")}
                    </p>
                  )}
                  <p className="mt-2 text-[12px] text-text-light-gray">
                    The scoped pool counts only work this agent can pick up: in
                    its labels and columns, and not owned by another agent. It is
                    discovery input, not automatically its queue.
                  </p>
                </section>

                <section className="bg-cardBackground rounded-[4px] p-4 shadow-md mb-3">
                  <div className="flex items-baseline gap-2">
                    <h2 className="font-semibold">Up next</h2>
                    <span className="ml-auto text-[12px] text-text-light-gray">
                      {pendingQueue.length} pending
                    </span>
                  </div>
                  {visiblePending.length === 0 ? (
                    <p className="mt-2 text-[13px] text-text-light-gray">
                      No queued tickets reported.
                    </p>
                  ) : (
                    <div className="mt-1">
                      {visiblePending.map((item, index) => (
                        <div
                          key={`${item.ticket}-${index}`}
                          className={cn(
                            "grid grid-cols-[22px_minmax(0,1fr)] gap-x-2 gap-y-1 items-baseline py-2.5 border-t border-comment-description-border first:border-t-0",
                            !embedded &&
                              "md:grid-cols-[22px_minmax(0,1fr)_150px_80px]",
                          )}
                        >
                          <span className="text-text-light-gray">{index + 1}</span>
                          <Link href={item.url} className="min-w-0">
                            <span className="text-hypertasks-purple">
                              {item.ticket}
                            </span>{" "}
                            {item.title}
                          </Link>
                          <span
                            className={cn(
                              "col-start-2 text-[12px] text-text-light-gray",
                              !embedded && "md:col-auto",
                            )}
                          >
                            {queueReasonLabel[item.reason]}
                            {item.dueAt &&
                              ` · due ${new Date(item.dueAt).toLocaleDateString()}`}
                          </span>
                          <span
                            className={cn(
                              "col-start-2 text-[12px]",
                              !embedded && "md:col-auto md:text-right",
                            )}
                          >
                            {item.priority ?? "Normal"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {pendingQueue.length > visiblePending.length && (
                    <p className="mt-1 text-[12px] text-text-light-gray">
                      +{pendingQueue.length - visiblePending.length} more in the worker queue
                    </p>
                  )}
                  {(agent.operations.counts.processedUnowned > 0 ||
                    agent.operations.counts.specialistOwned > 0) && (
                    <p className="mt-2 bg-newcomment-well rounded-[4px] px-3 py-2 text-[12px] text-text-light-gray">
                      <strong className="text-white-black">Not queued:</strong>{" "}
                      {agent.operations.counts.processedUnowned > 0 &&
                        `${agent.operations.counts.processedUnowned} unowned ${
                          agent.operations.counts.processedUnowned === 1
                            ? "ticket was"
                            : "tickets were"
                        } already processed but remain in the source column`}
                      {agent.operations.counts.processedUnowned > 0 &&
                        agent.operations.counts.specialistOwned > 0 &&
                        "; "}
                      {agent.operations.counts.specialistOwned > 0 &&
                        `${agent.operations.counts.specialistOwned} ${
                          agent.operations.counts.specialistOwned === 1
                            ? "ticket belongs"
                            : "tickets belong"
                        } to specialist agents`}
                      .
                    </p>
                  )}
                </section>
    </>
  );
}
