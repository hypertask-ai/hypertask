"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import toast from "react-hot-toast";

import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { cn } from "@/utils/undoActions/helperFuncs";
import SettingsCard from "./SettingsCard";
import { settingsActionButtonClass } from "./SettingsBillingRow";
import SettingsCodeRow from "./SettingsCodeRow";
import SettingsSectionShell from "./SettingsSectionShell";
import { managementKeyScopeLabel } from "./managementKeyScope";

const DEVELOPER_ACCESS_URL = "/api/users/developer-access";
const API_KEYS_URL = "/api/users/api-keys";

const EXPIRY_OPTIONS = [
  { label: "Never", value: undefined },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "365 days", value: 365 },
] as const;

// Lifetime given to a renewed key when the one being rotated has already
// expired and has no lifetime worth carrying over.
const ROTATE_RENEWAL_DAYS = 90;

// Matches the management-key form: a filled, rounded field so it reads as
// writable (HTPR-4340).
const inputClass =
  "h-10 w-full rounded-lg border-0 bg-comment-description px-3 text-dense font-medium text-white-black outline-none transition placeholder:text-text-light-gray focus:bg-modalBackground";

const chipClass =
  "rounded-[4px] bg-active-modal-element px-1.5 py-[1px] text-micro font-medium text-text-light-gray";

type RestApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  scope: string;
  active: boolean;
  expired: boolean;
};

type ManagementKey = {
  id: string;
  name: string | null;
  start: string | null;
  permissions: Record<string, string[]>;
  enabled: boolean;
  lastRequest: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type DeveloperAccess = {
  restApiKeys: RestApiKey[];
  managementKeys: ManagementKey[];
  mcpToken: { active: boolean; expiresAt: string | null; scope: string };
  connectedClients: { id: string; name: string; lastUsedAt: string }[];
};

const formatDate = (value: string | null) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const ChoiceButton = ({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) => (
  <button
    aria-pressed={active}
    className={cn(
      settingsActionButtonClass,
      active ? "bg-active-modal-element" : "text-text-light-gray",
    )}
    onClick={onClick}
    type="button"
  >
    {children}
  </button>
);

const CredentialLine = ({ children }: { children: ReactNode }) => (
  <p className="mt-1 text-micro font-medium text-text-light-gray">{children}</p>
);

const DeveloperAccessSection = () => {
  const [access, setAccess] = useState<DeveloperAccess | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>(90);
  const [isCreating, setIsCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<RestApiKey | null>(null);
  const [keyToRotate, setKeyToRotate] = useState<RestApiKey | null>(null);
  const [expiryEditorKeyId, setExpiryEditorKeyId] = useState<string | null>(
    null,
  );

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(DEVELOPER_ACCESS_URL, {
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to load developer access");
      }
      setAccess(data as DeveloperAccess);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load developer access",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setIsCreating(true);
    try {
      const response = await fetch(API_KEYS_URL, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          ...(expiresInDays ? { expiresInDays } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.apiKey?.key) {
        throw new Error(data.error || "Failed to create API key");
      }
      setCreatedKey(data.apiKey.key);
      setName("");
      await refresh();
      toast.success("API key created");
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : "Failed to create API key",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const confirmRotate = async () => {
    if (!keyToRotate) return;
    setBusyKeyId(keyToRotate.id);
    try {
      const response = await fetch(
        `${API_KEYS_URL}/${keyToRotate.id}/rotate`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          // An expired key carries a past expiry, so the API refuses to copy it
          // onto the replacement. Give the renewed key a fresh lifetime.
          body: JSON.stringify(
            keyToRotate.expired ? { expiresInDays: ROTATE_RENEWAL_DAYS } : {},
          ),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.success || !data.apiKey?.key) {
        throw new Error(data.error || "Failed to rotate API key");
      }
      setCreatedKey(data.apiKey.key);
      setKeyToRotate(null);
      await refresh();
      toast.success("API key rotated");
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : "Failed to rotate API key",
      );
    } finally {
      setBusyKeyId(null);
    }
  };

  const confirmRevoke = async () => {
    if (!keyToRevoke) return;
    setBusyKeyId(keyToRevoke.id);
    try {
      const response = await fetch(`${API_KEYS_URL}/${keyToRevoke.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to revoke API key");
      }
      setKeyToRevoke(null);
      await refresh();
      toast.success("API key revoked");
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : "Failed to revoke API key",
      );
    } finally {
      setBusyKeyId(null);
    }
  };

  const updateExpiry = async (key: RestApiKey, expiresInDays?: number) => {
    setBusyKeyId(key.id);
    try {
      const response = await fetch(`${API_KEYS_URL}/${key.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // The API distinguishes omission from an explicit null, so always send
        // the field: null is what clears the expiry.
        body: JSON.stringify({ expiresInDays: expiresInDays ?? null }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to update expiry");
      }
      setExpiryEditorKeyId(null);
      await refresh();
      toast.success("Expiry updated");
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : "Failed to update expiry",
      );
    } finally {
      setBusyKeyId(null);
    }
  };

  const restApiKeys = access?.restApiKeys ?? [];
  const managementKeys = access?.managementKeys ?? [];
  const connectedClients = access?.connectedClients ?? [];
  const mcp = access?.mcpToken;

  return (
    <SettingsSectionShell title="Developer access">
      <SettingsCard title="Overview">
        <p className="px-2 text-dense font-medium leading-relaxed text-text-light-gray">
          Every credential that can act on your account, in one place. REST API
          keys, management keys, and the bearer token shared by MCP clients and
          the CLI.
        </p>
        <p className="px-2 text-dense font-medium leading-relaxed text-text-light-gray">
          Management keys can be limited to agent and credential administration,
          team AI usage and spend, or full task and data access. Give each one an
          expiry, rotate it if it leaks, and revoke it when the script that used
          it is gone.
        </p>
      </SettingsCard>

      <SettingsCard title="Create a REST API key">
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
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Production deploy script"
              required
              value={name}
            />
            <span className="text-micro font-medium text-text-light-gray">
              Name it after the script or service that will use it.
            </span>
          </label>

          <div className="flex flex-col gap-1 px-2">
            <span className="text-dense font-semibold text-white-black">
              Expires
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
            <span className="text-micro font-medium text-text-light-gray">
              An expiry limits the damage if the key ever leaks.
            </span>
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

      <SettingsCard title="REST API keys">
        {error && (
          <p className="px-2 py-2 text-dense font-medium text-red-400">
            {error}
          </p>
        )}
        {isLoading ? (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            Loading developer access
          </p>
        ) : restApiKeys.length ? (
          <div className="flex flex-col">
            {restApiKeys.map((key) => {
              const status = key.revokedAt
                ? "Revoked"
                : key.expired
                  ? "Expired"
                  : null;
              return (
                <div
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-border-light-gray-thin px-2 py-3 last:border-b-0"
                  key={key.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-dense font-semibold text-white-black">
                        {key.name}
                      </p>
                      <span className={chipClass}>{key.scope}</span>
                      {status && (
                        <span className="text-micro font-medium text-text-light-gray">
                          {status}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-micro text-text-light-gray">
                      {key.keyPrefix}…
                    </p>
                    <CredentialLine>
                      Created {formatDate(key.createdAt)} · Last used{" "}
                      {formatDate(key.lastUsedAt)} · Expires{" "}
                      {formatDate(key.expiresAt)}
                    </CredentialLine>
                    {expiryEditorKeyId === key.id && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {EXPIRY_OPTIONS.map((option) => (
                          <ChoiceButton
                            active={false}
                            key={option.label}
                            onClick={() => void updateExpiry(key, option.value)}
                          >
                            {option.label}
                          </ChoiceButton>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className={settingsActionButtonClass}
                      disabled={Boolean(key.revokedAt) || busyKeyId === key.id}
                      onClick={() =>
                        setExpiryEditorKeyId(
                          expiryEditorKeyId === key.id ? null : key.id,
                        )
                      }
                      type="button"
                    >
                      Expiry
                    </button>
                    <button
                      className={settingsActionButtonClass}
                      disabled={Boolean(key.revokedAt) || busyKeyId === key.id}
                      onClick={() => setKeyToRotate(key)}
                      type="button"
                    >
                      Rotate
                    </button>
                    <button
                      className={settingsActionButtonClass}
                      disabled={Boolean(key.revokedAt) || busyKeyId === key.id}
                      onClick={() => setKeyToRevoke(key)}
                      type="button"
                    >
                      {key.revokedAt ? "Revoked" : "Revoke"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            No REST API keys
          </p>
        )}
      </SettingsCard>

      <SettingsCard title="Management keys">
        <p className="px-2 text-dense font-medium leading-relaxed text-text-light-gray">
          Keys that manage your agents and credentials. Create and revoke them
          in Management keys.
        </p>
        {isLoading ? (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            Loading management keys
          </p>
        ) : managementKeys.length ? (
          <div className="flex flex-col">
            {managementKeys.map((key) => (
              <div
                className="border-b border-border-light-gray-thin px-2 py-3 last:border-b-0"
                key={key.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-dense font-semibold text-white-black">
                    {key.name || "Unnamed key"}
                  </p>
                  <span className={chipClass}>
                    {managementKeyScopeLabel(key.permissions)}
                  </span>
                  {!key.enabled && (
                    <span className="text-micro font-medium text-text-light-gray">
                      Revoked
                    </span>
                  )}
                </div>
                <p className="font-mono text-micro text-text-light-gray">
                  {key.start || "htmk_"}…
                </p>
                <CredentialLine>
                  Created {formatDate(key.createdAt)} · Last used{" "}
                  {formatDate(key.lastRequest)} · Expires{" "}
                  {formatDate(key.expiresAt)}
                </CredentialLine>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            No management keys
          </p>
        )}
      </SettingsCard>

      <SettingsCard title="MCP and CLI token">
        <p className="px-2 text-dense font-medium leading-relaxed text-text-light-gray">
          MCP clients and the CLI share one bearer token. Renew or revoke it in
          MCP.
        </p>
        <div className="px-2 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-dense font-semibold text-white-black">
              {mcp?.active
                ? "Token active in this browser"
                : "No token in this browser"}
            </p>
            {mcp?.active && (
              <span className={chipClass}>{mcp.scope}</span>
            )}
          </div>
          <CredentialLine>
            {mcp?.active
              ? `Expires ${formatDate(mcp.expiresAt)}`
              : "A token issued on another device is not visible here. Connected clients below show what is actually using it."}
          </CredentialLine>
        </div>
      </SettingsCard>

      <SettingsCard title="Connected clients">
        {connectedClients.length ? (
          <div className="flex flex-col">
            {connectedClients.map((client) => (
              <div
                className="border-b border-border-light-gray-thin px-2 py-3 last:border-b-0"
                key={client.id}
              >
                <p className="text-dense font-semibold text-white-black">
                  {client.name}
                </p>
                <CredentialLine>
                  Last connected {formatDate(client.lastUsedAt)}
                </CredentialLine>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            No connected clients
          </p>
        )}
      </SettingsCard>

      {keyToRotate && (
        <ConfirmDialog
          confirmLabel="Rotate key"
          footerVerb="rotate"
          id="confirm-rotate-api-key"
          loading={busyKeyId === keyToRotate.id}
          loadingLabel="Rotating key"
          message={
            keyToRotate.expired
              ? `Rotate ${keyToRotate.name}? A new secret is issued, valid for ${ROTATE_RENEWAL_DAYS} days, and the current one stops working immediately.`
              : `Rotate ${keyToRotate.name}? A new secret is issued and the current one stops working immediately.`
          }
          onCancel={() => setKeyToRotate(null)}
          onConfirm={() => void confirmRotate()}
        />
      )}

      {keyToRevoke && (
        <ConfirmDialog
          confirmLabel="Revoke key"
          footerVerb="revoke"
          id="confirm-revoke-api-key"
          loading={busyKeyId === keyToRevoke.id}
          loadingLabel="Revoking key"
          message={`Revoke ${keyToRevoke.name}? Requests using this key stop working immediately.`}
          onCancel={() => setKeyToRevoke(null)}
          onConfirm={() => void confirmRevoke()}
        />
      )}
    </SettingsSectionShell>
  );
};

export default DeveloperAccessSection;
