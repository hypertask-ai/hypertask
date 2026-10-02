"use client";

import { cn } from "@/utils/undoActions/helperFuncs";
import toast from "react-hot-toast";
import { PROMPT_MAX, PROMPT_WARN } from "./agentDetailTypes";
import type { useAgentConfig } from "./useAgentConfig";
import type { useAgentDetailLifecycle } from "./useAgentDetailLifecycle";
import type { useAgentDetailState } from "./useAgentDetailState";

type Props = Pick<
  ReturnType<typeof useAgentDetailState>,
  | "editingPrompt"
  | "setPromptDraft"
  | "setEditingPrompt"
  | "promptDraft"
  | "savingPrompt"
  | "tokenBusy"
> &
  { agent: NonNullable<ReturnType<typeof useAgentDetailState>["agent"]> } &
  Pick<
  ReturnType<typeof useAgentConfig>,
  | "handleSavePrompt"
> &
  Pick<
  ReturnType<typeof useAgentDetailLifecycle>,
  | "handleGenerateToken"
  | "handleRevokeToken"
>;

export function AgentInstructions({
  agent, editingPrompt, setPromptDraft, setEditingPrompt, promptDraft, savingPrompt,
  handleSavePrompt, tokenBusy, handleGenerateToken, handleRevokeToken,
}: Props) {
  return (
    <>
                {agent.runtimeType === "NATIVE" && (
                  <div className="bg-cardBackground rounded-[4px] p-4 shadow-md mb-3">
                    <div className="flex items-center">
                      <h2 className="font-semibold">Instructions</h2>
                      <span className="flex-1" />
                      {!editingPrompt && (
                        <button
                          type="button"
                          className="text-[13px] text-hypertasks-purple"
                          onClick={() => {
                            setPromptDraft(agent.prompt ?? "");
                            setEditingPrompt(true);
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </div>

                    {!editingPrompt ? (
                      <div className="mt-3 bg-newcomment-well rounded-[4px] p-3 text-[13px] whitespace-pre-wrap">
                        {agent.prompt || (
                          <span className="text-text-light-gray">
                            No instructions set
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3">
                        <textarea
                          value={promptDraft}
                          onChange={(e) => setPromptDraft(e.target.value)}
                          rows={8}
                          className="w-full bg-transparent outline-none resize-y text-[13px]"
                        />
                        {promptDraft.length > PROMPT_WARN && (
                          <p
                            className={cn(
                              "mt-1 text-[12px]",
                              promptDraft.length > PROMPT_MAX
                                ? "text-red-500"
                                : "text-text-light-gray",
                            )}
                          >
                            {promptDraft.length} / {PROMPT_MAX}
                          </p>
                        )}
                        <div className="mt-2 flex gap-3">
                          <button
                            type="button"
                            disabled={
                              savingPrompt || promptDraft.length > PROMPT_MAX
                            }
                            onClick={handleSavePrompt}
                            className="text-[13px] text-hypertasks-purple disabled:opacity-50"
                          >
                            {savingPrompt ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPrompt(false)}
                            className="text-[13px] text-text-light-gray"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Native agents run inside Hypertask, and the mint endpoint
                    refuses them, so only external agents get this block. */}
                {agent.runtimeType === "EXTERNAL" && (
                  <div className="bg-cardBackground rounded-[4px] p-4 shadow-md mb-3">
                    <h2 className="font-semibold">Access key</h2>
                    <p className="mt-1 text-[13px] text-text-light-gray">
                      Your runtime authenticates with this key. Turning the
                      agent off destroys it.
                    </p>

                    {agent.mcpToken ? (
                      <div className="mt-3">
                        <div className="bg-newcomment-well rounded-[4px] p-3">
                          <code className="text-[12px] break-all">
                            {agent.mcpToken}
                          </code>
                        </div>
                        <div className="mt-2 flex gap-4">
                          <button
                            type="button"
                            className="text-[13px] text-hypertasks-purple"
                            onClick={() => {
                              void navigator.clipboard.writeText(
                                agent.mcpToken ?? "",
                              );
                              toast.success("Key copied");
                            }}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            disabled={tokenBusy}
                            className="text-[13px] text-hypertasks-purple disabled:opacity-50"
                            onClick={() => void handleGenerateToken()}
                          >
                            {tokenBusy ? "Working…" : "Regenerate"}
                          </button>
                          <button
                            type="button"
                            disabled={tokenBusy}
                            className="text-[13px] text-text-light-gray disabled:opacity-50"
                            onClick={() => void handleRevokeToken()}
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    ) : agent.hasMcpToken ? (
                      /* The routes only ever send the value once, at minting, so
                       an existing key can be replaced or revoked but not read
                       back — saying "no key yet" here would be a lie. */
                      <div className="mt-3">
                        <p className="text-[13px] text-text-light-gray">
                          A key is set. It was shown once when it was created.
                        </p>
                        <div className="mt-2 flex gap-4">
                          <button
                            type="button"
                            disabled={tokenBusy}
                            className="text-[13px] text-hypertasks-purple disabled:opacity-50"
                            onClick={() => void handleGenerateToken()}
                          >
                            {tokenBusy ? "Working…" : "Regenerate"}
                          </button>
                          <button
                            type="button"
                            disabled={tokenBusy}
                            className="text-[13px] text-text-light-gray disabled:opacity-50"
                            onClick={() => void handleRevokeToken()}
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3">
                        <p className="text-[13px] text-text-light-gray">
                          {agent.revokedAt
                            ? "No key. Turn the agent on, then generate one."
                            : "No key yet."}
                        </p>
                        <button
                          type="button"
                          disabled={tokenBusy || Boolean(agent.revokedAt)}
                          className="mt-2 text-[13px] text-hypertasks-purple disabled:opacity-50"
                          onClick={() => void handleGenerateToken()}
                        >
                          {tokenBusy ? "Generating…" : "Generate a key"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
    </>
  );
}
