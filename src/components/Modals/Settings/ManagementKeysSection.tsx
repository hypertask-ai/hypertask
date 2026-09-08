"use client";

import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { TEAM_SCOPED_MANAGEMENT_KEYS_FLAG } from "@/lib/flags/keys";
import { useFlag } from "@/hooks/useFlag";
import { cn } from "@/utils/undoActions/helperFuncs";
import SettingsCard from "./SettingsCard";
import { settingsActionButtonClass } from "./SettingsBillingRow";
import SettingsCodeRow from "./SettingsCodeRow";
import SettingsSectionShell from "./SettingsSectionShell";
import {
  managementKeyScopeLabel,
  managementKeyTeamLabel,
} from "./managementKeyScope";
import {
  useManagementKeys,
  type ManagementKey,
  type ManagementKeyScope,
} from "./useManagementKeys";

const EXPIRY_OPTIONS = [
  { label: "Never", value: undefined },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "365 days", value: 365 },
] as const;

// HTPR-4340 affordance fix: a filled, rounded field so it reads as writable
// (the old borderless transparent input looked like static text — the
// placeholder was mistaken for a filled-in value).
const inputClass =
  "h-10 w-full rounded-lg border-0 bg-comment-description px-3 text-dense font-medium text-white-black outline-none transition placeholder:text-text-light-gray focus:bg-modalBackground";

const ChoiceButton = ({
  active,
  children,
  disabled = false,
  onClick,
}: {
  active: boolean;
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    aria-pressed={active}
    className={cn(
      settingsActionButtonClass,
      active ? "bg-active-modal-element" : "text-text-light-gray",
      disabled && "cursor-not-allowed opacity-50",
    )}
    disabled={disabled}
    onClick={onClick}
    type="button"
  >
    {children}
  </button>
);

const formatDate = (value: string) => new Date(value).toLocaleDateString();

const revokeButtonLabel = (enabled: boolean, revoking: boolean) => {
  if (revoking) return "Revoking";
  return enabled ? "Revoke" : "Revoked";
};

const teamScopeDescription = (
  scope: ManagementKeyScope,
  teamId: string | null,
) => {
  if (scope === "full") {
    return "Full access stays account-wide because data routes are not team-scoped.";
  }
  if (!teamId) {
    return scope === "usage"
      ? "This key can read usage for any team you own."
      : "This key can manage agents and keys across your account.";
  }
  if (scope === "usage") {
    return "A team usage key reads totals only for a team you own.";
  }
  return "A team key manages only your agents and keys in that team.";
};

const ManagementKeysSection = () => {
  const teamScopedKeysEnabled = useFlag(TEAM_SCOPED_MANAGEMENT_KEYS_FLAG);
  const {
    keys,
    teams,
    error,
    isCreating,
    isLoading,
    revokingKeyId,
    createKey,
    revokeKey,
  } = useManagementKeys();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ManagementKeyScope>("management");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<ManagementKey | null>(null);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    try {
      const result = await createKey({
        name: trimmedName,
        scope,
        ...(teamId ? { teamId } : {}),
        ...(expiresInDays ? { expiresInDays } : {}),
      });
      setCreatedKey(result.key);
      setName("");
      setScope("management");
      setTeamId(null);
      setExpiresInDays(undefined);
      toast.success("Management key created");
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : "Failed to create management key",
      );
    }
  };

  const confirmRevoke = async () => {
    if (!keyToRevoke) return;
    try {
      await revokeKey(keyToRevoke.id);
      toast.success("Management key revoked");
      setKeyToRevoke(null);
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : "Failed to revoke management key",
      );
    }
  };

  return (
    <SettingsSectionShell title="Management keys">
      <SettingsCard title="Overview">
        <p className="px-2 text-dense font-medium leading-relaxed text-text-light-gray">
          Management keys let API, CLI, MCP, and AI chat clients manage your
          agents and API credentials programmatically. Usage keys expose only
          team AI usage counts and model spend; Full access also enables task
          and data endpoints.
        </p>
      </SettingsCard>

      <SettingsCard title="Create key">
        <form className="flex flex-col gap-3" onSubmit={handleCreate}>
          <label className="flex flex-col gap-1.5 px-2">
            <span className="text-dense font-semibold text-white-black">
              Name
            </span>
            <input
              autoComplete="off"
              className={inputClass}
              data-1p-ignore
              data-form-type="other"
              data-lpignore="true"
              maxLength={32}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. CI automation"
              required
              value={name}
            />
            <span className="text-micro font-medium text-text-light-gray">
              A label so you can recognise this key later.
            </span>
          </label>

          <div className="flex flex-col gap-1 px-2">
            <span className="text-dense font-semibold text-white-black">
              Scope
            </span>
            <div className="flex flex-wrap gap-2">
              <ChoiceButton
                active={scope === "management"}
                onClick={() => setScope("management")}
              >
                Management
              </ChoiceButton>
              <ChoiceButton
                active={scope === "usage"}
                onClick={() => {
                  setScope("usage");
                  if (
                    teamId &&
                    !teams.find((team) => team.id === teamId)?.isOwner
                  ) {
                    setTeamId(null);
                  }
                }}
              >
                Usage
              </ChoiceButton>
              <ChoiceButton
                active={scope === "full"}
                disabled={teamId !== null}
                onClick={() => setScope("full")}
              >
                Full access
              </ChoiceButton>
            </div>
          </div>

          {teamScopedKeysEnabled && (
            <div className="flex flex-col gap-1 px-2">
              <span className="text-dense font-semibold text-white-black">
                Team
              </span>
              <div className="flex flex-wrap gap-2">
                <ChoiceButton
                  active={teamId === null}
                  onClick={() => setTeamId(null)}
                >
                  Whole account
                </ChoiceButton>
                {teams.map((team) => (
                  <ChoiceButton
                    active={teamId === team.id}
                    disabled={
                      scope === "full" || (scope === "usage" && !team.isOwner)
                    }
                    key={team.id}
                    onClick={() => setTeamId(team.id)}
                  >
                    {team.title || "Untitled team"}
                  </ChoiceButton>
                ))}
              </div>
              <span className="text-micro font-medium text-text-light-gray">
                {teamScopeDescription(scope, teamId)}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1 px-2">
            <span className="text-dense font-semibold text-white-black">
              Expiry
            </span>
            <div className="flex flex-wrap gap-2">
              {EXPIRY_OPTIONS.map((option) => (
                <ChoiceButton
                  active={expiresInDays === option.value}
                  key={option.label}
                  onClick={() => setExpiresInDays(option.value)}
                >
                  {option.label}
                </ChoiceButton>
              ))}
            </div>
          </div>

          <button
            className={cn(
              "ml-2 mt-1 inline-flex w-fit items-center gap-2 rounded-lg px-4 py-2 text-dense font-semibold text-white-black transition",
              "bg-active-modal-element hover:brightness-110",
              "disabled:cursor-not-allowed disabled:bg-containerBackground disabled:text-text-light-gray disabled:hover:brightness-100",
            )}
            disabled={isCreating || !name.trim()}
            type="submit"
          >
            <svg
              aria-hidden
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.2"
              viewBox="0 0 24 24"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {isCreating ? "Creating…" : "Create key"}
          </button>
        </form>
      </SettingsCard>

      {createdKey && (
        <SettingsCard title="New key">
          <p className="px-2 text-dense font-semibold text-white-black">
            Copy it now, it won&apos;t be shown again.
          </p>
          <SettingsCodeRow value={createdKey} />
        </SettingsCard>
      )}

      <SettingsCard title="Existing keys">
        {error && (
          <p className="px-2 py-2 text-dense font-medium text-red-400">
            {error}
          </p>
        )}
        {isLoading ? (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            Loading management keys
          </p>
        ) : keys.length ? (
          <div className="flex flex-col">
            {keys.map((key) => {
              const teamLabel = managementKeyTeamLabel(
                key.teamScoped,
                key.team,
                teamScopedKeysEnabled,
              );
              const isRevoking = revokingKeyId === key.id;
              return (
                <div
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-border-light-gray-thin px-2 py-3 last:border-b-0"
                  key={key.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-dense font-semibold text-white-black">
                        {key.name || "Unnamed key"}
                      </p>
                      <span className="rounded-[4px] bg-active-modal-element px-1.5 py-[1px] text-micro font-medium text-text-light-gray">
                        {managementKeyScopeLabel(key.permissions)}
                      </span>
                      {teamLabel && (
                        <span className="rounded-[4px] bg-active-modal-element px-1.5 py-[1px] text-micro font-medium text-text-light-gray">
                          {teamLabel}
                        </span>
                      )}
                      {!key.enabled && (
                        <span className="text-micro font-medium text-text-light-gray">
                          Revoked
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-micro text-text-light-gray">
                      {key.start || (key.teamScoped ? "httk_" : "htmk_")}…
                    </p>
                    <p className="mt-1 text-micro font-medium text-text-light-gray">
                      Created {formatDate(key.createdAt)} · Last used{" "}
                      {key.lastRequest ? formatDate(key.lastRequest) : "Never"}{" "}
                      · Expires{" "}
                      {key.expiresAt ? formatDate(key.expiresAt) : "Never"}
                    </p>
                  </div>
                  <button
                    className={settingsActionButtonClass}
                    disabled={!key.enabled || isRevoking}
                    onClick={() => setKeyToRevoke(key)}
                    type="button"
                  >
                    {revokeButtonLabel(key.enabled, isRevoking)}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            No management keys
          </p>
        )}
      </SettingsCard>

      {keyToRevoke && (
        <ConfirmDialog
          confirmLabel="Revoke key"
          footerVerb="revoke"
          id="confirm-revoke-management-key"
          loading={revokingKeyId === keyToRevoke.id}
          loadingLabel="Revoking key"
          message={`Revoke ${keyToRevoke.name || "this management key"}? Clients using it will lose access.`}
          onCancel={() => setKeyToRevoke(null)}
          onConfirm={() => void confirmRevoke()}
        />
      )}
    </SettingsSectionShell>
  );
};

export default ManagementKeysSection;
