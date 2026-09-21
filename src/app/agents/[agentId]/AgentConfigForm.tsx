import { PROMPT_MAX, PROMPT_WARN, elapsedSince, healthDotClass, healthLabel, queueReasonLabel, statusDotClass, statusWord } from "./AgentActivityFeed";
import { AgentSwitch, InfoRow, RecentActionsCard, timeAgo } from "./AgentRunHistory";
import Link from "next/link";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { aiModelOptions } from "@/lib/aiModelOptions";
import toast from "react-hot-toast";
import { canPinModelOption } from "@/lib/nativeAgent/modelPin";
import { cn } from "@/utils/undoActions/helperFuncs";
import AgentSelect, { AgentOption } from "../AgentSelect";
import WorkingSpinner from "../WorkingSpinner";
import AgentAvatar from "@/components/Agents/AgentAvatar";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";

type ViewContext = Record<string, any>;

export function renderAgentConfigForm(context: ViewContext) {
  const { activeWork, activity, activityError, agent, agentId, appShellRailOn, archiving, boardAccessOpen, boardErrors, boardToRemove, changeBoardMembership, confirmTeamVisibility, currentUser, deleting, editingName, editingPrompt, editingProviderKey, embedded, error, handleArchiveToggle, handleDelete, handleGenerateToken, handleImportantToggle, handleModelChange, handleOpenChat, handleRemoveProviderKey, handleRevokeToken, handleSaveName, handleSavePrompt, handleSaveProviderKey, handleToggle, handleVisibilityChange, manageOpen, nameDraft, now, openingChat, operationsHealth, pendingBoardId, pendingQueue, promptDraft, providerKey, providerKeyDraft, providerKeyLoaded, runtimeSnapshot, saveVisibility, savingImportant, savingModel, savingName, savingPrompt, savingProviderKey, savingVisibility, setBoardAccessOpen, setBoardToRemove, setConfirmTeamVisibility, setEditingName, setEditingPrompt, setEditingProviderKey, setManageOpen, setNameDraft, setPromptDraft, setProviderKeyDraft, togglePending, tokenBusy, visibilityNotice, visiblePending, working, workingNowDot, workingNowLabel } = context;
const content = (
    <div
      className={cn(
        "bg-pageBackground text-white-black text-[14px]",
        !embedded && "min-h-screen",
      )}
    >
      <div className="max-w-[1120px] mx-auto px-6 py-7">
        <Link
          href="/agents"
          className="text-[13px] text-text-light-gray hover:text-white-black"
        >
          ← Agents
        </Link>

        {error && <p className="mt-6 text-[13px] text-red-500">{error}</p>}
        {!error && !agent && (
          <p className="mt-6 text-[13px] text-text-light-gray">
            Loading agent…
          </p>
        )}

        {!error && agent && (
          <>
            <div
              className={cn(
                "mt-4 flex items-center gap-3",
                embedded && "flex-wrap",
              )}
            >
              <AgentAvatar agentId={agent.id} name={agent.displayName} photoURL={agent.photoURL} size={34} className="text-[13px]" />
              {working ? (
                <WorkingSpinner label={`${agent.displayName} is working now`} />
              ) : (
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    statusDotClass[statusWord(agent)],
                  )}
                />
              )}
              {editingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => void handleSaveName()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  disabled={savingName}
                  aria-label="Agent name"
                  // Borderless, like every other input here: the house style is
                  // no boxes, and the field already reads as the title it edits.
                  className="text-[20px] font-semibold bg-transparent outline-none min-w-0 flex-1"
                />
              ) : (
                <h1
                  className="text-[20px] font-semibold truncate cursor-text"
                  title="Click to rename"
                  onClick={() => {
                    setNameDraft(agent.displayName);
                    setEditingName(true);
                  }}
                >
                  {agent.displayName}
                </h1>
              )}
              <span className="flex-1" />
              {/* The two actions the manage modal used to carry: a native
                  agent is talked to in chat, an external one reports through
                  its inbox. Same split as the modal's row buttons. */}
              {agent.runtimeType === "NATIVE" ? (
                <button
                  type="button"
                  disabled={openingChat}
                  onClick={() => void handleOpenChat()}
                  className="text-[13px] text-hypertasks-purple disabled:opacity-50"
                >
                  {openingChat ? "Opening…" : "Chat"}
                </button>
              ) : (
                <Link
                  href={`/inbox/agent/${agent.id}`}
                  className="text-[13px] text-hypertasks-purple"
                >
                  Inbox
                </Link>
              )}
              <span className="text-[13px] text-text-light-gray">
                {working ? "Working" : statusWord(agent)}
              </span>
              <span
                className="text-[13px] text-text-light-gray"
                title="Tickets currently assigned to this agent"
              >
                {agent.operations.counts.assigned} assigned ticket
                {agent.operations.counts.assigned === 1 ? "" : "s"}
              </span>
              <AgentSwitch
                on={!agent.revokedAt}
                displayName={agent.displayName}
                onToggle={() => void handleToggle()}
                pending={togglePending}
              />
            </div>

            <div
              className={cn(
                "mt-6 grid grid-cols-1 gap-5 items-start",
                !embedded && "lg:[grid-template-columns:1fr_300px]",
              )}
            >
              <div>
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
                        .map(({ section, eligible }: any) => `${section} ${eligible}`)
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
                      {visiblePending.map((item: any, index: number) => (
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
                            {queueReasonLabel[item.reason as keyof typeof queueReasonLabel]}
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

              </div>

              <div className="flex flex-col gap-3">
                <section className="bg-comment-description rounded-[4px] px-4 py-3 shadow-md flex flex-col gap-1.5">
                  <h2 className="font-semibold mb-1">Runtime health</h2>
                  <InfoRow label="State">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          healthDotClass[operationsHealth as keyof typeof healthDotClass],
                        )}
                      />
                      {healthLabel[operationsHealth as keyof typeof healthLabel]}
                    </span>
                  </InfoRow>
                  <InfoRow label="Source">
                    {agent.operations.source === "runtime"
                      ? "Live worker"
                      : "Inferred from board"}
                  </InfoRow>
                  <InfoRow label="Worker">
                    {runtimeSnapshot?.workerId ?? "Not connected"}
                  </InfoRow>
                  <InfoRow label="Heartbeat">
                    {runtimeSnapshot?.heartbeatAt
                      ? `${elapsedSince(runtimeSnapshot.heartbeatAt, now)} ago`
                      : "Never"}
                  </InfoRow>
                  <InfoRow label="Progress">
                    {runtimeSnapshot?.lastProgressAt
                      ? `${elapsedSince(runtimeSnapshot.lastProgressAt, now)} ago`
                      : "Unreported"}
                  </InfoRow>
                </section>

                <section className="bg-comment-description rounded-[4px] px-4 py-3 shadow-md flex flex-col gap-1.5">
                  <h2 className="font-semibold mb-1">Configuration</h2>
                <InfoRow label="Runs on">
                  {agent.runtimeType === "NATIVE"
                    ? "Hypertask · native"
                    : "Your own runtime"}
                </InfoRow>
                {/* Only a native agent's turns run on Hypertask's models, so
                    an external agent gets no picker rather than one that
                    saves and changes nothing. */}
                {agent.runtimeType === "NATIVE" && (
                  <InfoRow label="Model">
                    <AgentSelect
                      value={agent.modelOptionId ?? ""}
                      onChange={handleModelChange}
                      disabled={savingModel}
                      ariaLabel="Model this agent runs on"
                    >
                      <AgentOption value="">Team default</AgentOption>
                      {/* Same list the PATCH route enforces, so the picker can
                        never offer something the API will reject. */}
                      {aiModelOptions
                        .filter((option) => canPinModelOption(option.id))
                        .map((option) => (
                          <AgentOption key={option.id} value={option.id}>
                            {option.title}
                          </AgentOption>
                        ))}
                    </AgentSelect>
                  </InfoRow>
                )}
                {/* Team key by default. Pasting a key here moves this agent's
                    spend onto that provider account, which is what makes its
                    cost an invoice instead of an estimate. */}
                <InfoRow label="Provider key">
                  {editingProviderKey ? (
                    <input
                      autoFocus
                      type="password"
                      value={providerKeyDraft}
                      onChange={(e) => setProviderKeyDraft(e.target.value)}
                      onBlur={() => void handleSaveProviderKey()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSaveProviderKey();
                        if (e.key === "Escape") {
                          setProviderKeyDraft("");
                          setEditingProviderKey(false);
                        }
                      }}
                      disabled={savingProviderKey || savingVisibility}
                      placeholder="Paste an OpenRouter key"
                      aria-label="OpenRouter key for this agent"
                      className="bg-transparent outline-none min-w-0 w-[220px]"
                    />
                  ) : (
                    <span
                      className="flex items-center gap-2"
                      data-agent-provider-key
                    >
                      <span
                        className="cursor-text"
                        title="Click to set an OpenRouter key"
                        onClick={() => setEditingProviderKey(true)}
                      >
                        {providerKey?.maskedKey
                          ? `OpenRouter ${providerKey.maskedKey}`
                          : "Team key"}
                      </span>
                      {providerKey?.maskedKey && (
                        <button
                          type="button"
                          disabled={savingProviderKey || savingVisibility}
                          className="text-[12px] text-text-light-gray"
                          onClick={() => void handleRemoveProviderKey()}
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  )}
                </InfoRow>
                <InfoRow label="Visibility">
                  <span className="flex min-w-0 flex-col gap-1">
                    <AgentSelect
                      value={agent.visibility}
                      onChange={handleVisibilityChange}
                      disabled={
                        savingVisibility ||
                        savingProviderKey ||
                        (agent.runtimeType === "NATIVE" && !providerKeyLoaded)
                      }
                      ariaLabel="Who can use this agent"
                    >
                      <AgentOption value="PRIVATE">Private</AgentOption>
                      <AgentOption value="TEAM">Team</AgentOption>
                    </AgentSelect>
                    {visibilityNotice && (
                      <span
                        className={cn(
                          "text-[12px] leading-4",
                          visibilityNotice.kind === "error"
                            ? "text-red-500"
                            : "text-hypertasks-green",
                        )}
                      >
                        {visibilityNotice.text}
                      </span>
                    )}
                  </span>
                </InfoRow>
                <InfoRow label="Important">
                  <span className="flex items-center gap-2">
                    <AgentSwitch
                      on={agent.postsToImportant !== false}
                      displayName={agent.displayName}
                      pending={savingImportant}
                      ariaLabel={`Let ${agent.displayName} post to Important`}
                      onToggle={() => void handleImportantToggle()}
                    />
                    <span className="text-text-light-gray">
                      {agent.postsToImportant === false
                        ? "Agents split only"
                        : "Can post"}
                    </span>
                  </span>
                </InfoRow>
                <InfoRow label="Owner">
                  {currentUser.displayName || "You"}
                </InfoRow>
                <InfoRow label="Created">
                  {new Date(agent.createdAt).toLocaleDateString()}
                </InfoRow>
                {agent.runtimeType === "NATIVE" && (
                  <InfoRow label="Heartbeat">
                    {agent.heartbeatAt ? (
                      timeAgo(agent.heartbeatAt)
                    ) : (
                      <span className="text-text-light-gray">Never</span>
                    )}
                  </InfoRow>
                )}
                </section>
              </div>
            </div>

            <RecentActionsCard
              activity={activity}
              error={activityError}
              showTokenUsage={agent.runtimeType === "NATIVE"}
              embedded={embedded}
            />

            <div className="mt-6 bg-cardBackground rounded-[4px] shadow-md">
              <button
                type="button"
                aria-expanded={boardAccessOpen}
                onClick={() => setBoardAccessOpen((open: boolean) => !open)}
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
                    agent.boardAccess.map((board: any) => {
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
                onClick={() => setManageOpen((open: boolean) => !open)}
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
        )}
      </div>
    </div>
  );

return (
    <>
      {appShellRailOn && (
        <AppShellRail variant="global" currentUser={currentUser} />
      )}
      {appShellRailOn ? (
        <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div>
      ) : (
        content
      )}
    </>
  );
}
