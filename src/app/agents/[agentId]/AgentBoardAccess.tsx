"use client";

import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { cn } from "@/utils/undoActions/helperFuncs";
import Link from "next/link";
import { timeAgo } from "./AgentDetailParts";
import type { useAgentBoardAccess } from "./useAgentBoardAccess";
import type { useAgentConfig } from "./useAgentConfig";
import type { useAgentDetailState } from "./useAgentDetailState";

type Props = Pick<
  ReturnType<typeof useAgentDetailState>,
  | "boardAccessOpen"
  | "setBoardAccessOpen"
  | "pendingBoardId"
  | "setBoardToRemove"
  | "boardErrors"
  | "confirmTeamVisibility"
  | "setConfirmTeamVisibility"
  | "boardToRemove"
  | "manageOpen"
  | "setManageOpen"
  | "archiving"
  | "deleting"
> &
  { agent: NonNullable<ReturnType<typeof useAgentDetailState>["agent"]> } &
  Pick<
  ReturnType<typeof useAgentBoardAccess>,
  | "changeBoardMembership"
  | "handleArchiveToggle"
  | "handleDelete"
> &
  Pick<
  ReturnType<typeof useAgentConfig>,
  | "saveVisibility"
>;

export function AgentBoardAccess({
  boardAccessOpen, setBoardAccessOpen, agent, pendingBoardId, setBoardToRemove,
  changeBoardMembership, boardErrors, confirmTeamVisibility, setConfirmTeamVisibility,
  saveVisibility, boardToRemove, manageOpen, setManageOpen, archiving, handleArchiveToggle,
  deleting, handleDelete,
}: Props) {
  return (
    <>
            <div className="mt-6 bg-cardBackground rounded-[4px] shadow-md">
              <button
                type="button"
                aria-expanded={boardAccessOpen}
                onClick={() => setBoardAccessOpen((open) => !open)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left"
              >
                <span className="text-text-light-gray">
                  {boardAccessOpen ? "▾" : "▸"}
                </span>
                <span>
                  <strong className="block">Board access</strong>
                  <span className="text-[12px] text-text-light-gray">
                    This agent is a member of {agent.boards?.length ?? 0}{" "}
                    {(agent.boards?.length ?? 0) === 1 ? "board" : "boards"}
                  </span>
                </span>
              </button>

              {boardAccessOpen && (
                <div className="border-t border-comment-description-border px-4 pb-2">
                  <p className="py-3 text-[13px] text-text-light-gray">
                    Tick a board to give this agent access. Changes save
                    immediately.
                  </p>
                  {agent.boardAccess.length === 0 ? (
                    <p className="pb-3 text-[13px] text-text-light-gray">
                      No accessible boards.
                    </p>
                  ) : (
                    agent.boardAccess.map((board) => {
                      const pending = pendingBoardId === board.id;
                      const additionBlocked =
                        !board.member && Boolean(agent.revokedAt);
                      return (
                        <div
                          key={board.id}
                          className="flex items-start gap-3 border-t border-comment-description-border py-3 first:border-t-0"
                        >
                          <input
                            type="checkbox"
                            checked={board.member}
                            disabled={
                              pendingBoardId !== null ||
                              !board.canChange ||
                              additionBlocked
                            }
                            aria-label={`${board.member ? "Remove" : "Add"} ${agent.displayName} ${board.member ? "from" : "to"} ${board.name}`}
                            onChange={() => {
                              if (board.member) setBoardToRemove(board);
                              else void changeBoardMembership(board, true);
                            }}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-hypertasks-purple disabled:opacity-40"
                          />
                          <div className="min-w-0">
                            <Link
                              href={`/project?id=${board.id}`}
                              className="text-hypertasks-purple"
                            >
                              {board.name}
                            </Link>
                            <p
                              className={cn(
                                "mt-0.5 text-[12px]",
                                boardErrors[board.id]
                                  ? "text-red-500"
                                  : "text-text-light-gray",
                              )}
                            >
                              {pending
                                ? "Saving..."
                                : boardErrors[board.id] ??
                                  (additionBlocked
                                    ? "Turn the agent on before adding it"
                                    : board.unavailableReason ??
                                      (board.member
                                        ? `Member${board.teamName ? ` · ${board.teamName}` : ""}`
                                        : `Not a member${board.teamName ? ` · ${board.teamName}` : ""}`))}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {confirmTeamVisibility && (
              <ConfirmDialog
                id="confirm-team-agent-owner-plan"
                message="Team members will use your plan for this agent. Continue?"
                confirmLabel="Continue"
                onConfirm={() => {
                  setConfirmTeamVisibility(false);
                  void saveVisibility("TEAM");
                }}
                onCancel={() => setConfirmTeamVisibility(false)}
              />
            )}

            {boardToRemove && (
              <ConfirmDialog
                id="remove-agent-board-access"
                message={`Remove ${agent.displayName} from ${boardToRemove.name}?`}
                confirmLabel="Remove from board"
                loadingLabel="Removing..."
                loading={pendingBoardId === boardToRemove.id}
                onConfirm={() =>
                  void changeBoardMembership(boardToRemove, false)
                }
                onCancel={() => setBoardToRemove(null)}
                footerVerb="remove"
              >
                <p className="px-4 py-3 text-[13px] text-text-light-gray">
                  The agent will lose access to this board and its content. You
                  can add it again later.
                </p>
              </ConfirmDialog>
            )}

            {/* Collapsed by default: archiving and deleting are the two things
                on this page you cannot undo with the switch next to the name,
                so they do not sit open next to the everyday controls. */}
            <div className="mt-6 bg-cardBackground rounded-[4px] shadow-md">
              <button
                type="button"
                aria-expanded={manageOpen}
                onClick={() => setManageOpen((open) => !open)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left"
              >
                <span className="text-text-light-gray">
                  {manageOpen ? "▾" : "▸"}
                </span>
                <span className="font-semibold">Archive or delete</span>
                {agent.archivedAt && (
                  <span className="text-[13px] text-text-light-gray">
                    · archived {timeAgo(agent.archivedAt)}
                  </span>
                )}
              </button>

              {manageOpen && (
                <div className="px-4 pb-4 flex flex-col gap-4">
                  <div>
                    <p className="text-[13px] text-text-light-gray">
                      Archiving files the agent away. It keeps its history and
                      its boards, stops showing in the register, and can be
                      restored from the Archived filter at any time.
                    </p>
                    <button
                      type="button"
                      disabled={archiving}
                      onClick={() => void handleArchiveToggle()}
                      className="mt-2 text-[13px] text-hypertasks-purple disabled:opacity-50"
                    >
                      {archiving
                        ? "Working…"
                        : agent.archivedAt
                          ? "Restore agent"
                          : "Archive agent"}
                    </button>
                  </div>

                  <div className="border-t border-comment-description-border pt-4">
                    <p className="text-[13px] text-text-light-gray">
                      Deleting removes the agent, its board memberships and its
                      task assignments for good. Comments it posted stay as
                      history. This cannot be undone.
                    </p>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void handleDelete()}
                      className="mt-2 text-[13px] text-red-500 disabled:opacity-50"
                    >
                      {deleting ? "Deleting…" : "Delete agent"}
                    </button>
                  </div>
                </div>
              )}
            </div>
    </>
  );
}
