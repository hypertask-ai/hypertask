"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MdAdd } from "react-icons/md";
import SignOutModal from "@/components/Modals/SignOut/SignOutModal";
import { useSignout } from "@/hooks/MultiPages/HTC/useSignout";
import { authClient } from "@/lib/auth/betterAuthClient";
import {
  addAccount,
  getActiveAccountId,
  listAccounts,
  mergeCurrentAccount,
  removeAccount,
  switchAccount,
  SwitchAccount,
} from "@/lib/auth/accounts";
import SettingsCard from "./SettingsCard";
import { settingsActionButtonClass } from "./SettingsBillingRow";
import SettingsSectionShell from "./SettingsSectionShell";
import UserAvatar from "@/components/Common/UserAvatar";

const AccountsSection = () => {
  const { handleHardReset } = useSignout();
  const [accounts, setAccounts] = useState<SwitchAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [showSignOut, setShowSignOut] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [passkeysSupported, setPasskeysSupported] = useState<boolean | null>(
    null,
  );
  const [passkeyPending, setPasskeyPending] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);
  const {
    data: passkeys,
    isPending: passkeysLoading,
    refetch: refetchPasskeys,
  } = authClient.useListPasskeys();
  const activeId = getActiveAccountId();

  const refreshAccounts = useCallback(async () => {
    const nextAccounts = await listAccounts();
    setAccounts(nextAccounts);
    setLoading(false);
    return nextAccounts;
  }, []);

  useEffect(() => {
    setPasskeysSupported(
      typeof window !== "undefined" && !!window.PublicKeyCredential,
    );
  }, []);

  useEffect(() => {
    if (!passkeyMessage) return;

    const timeout = window.setTimeout(() => setPasskeyMessage(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [passkeyMessage]);

  useEffect(() => {
    let alive = true;
    listAccounts().then((nextAccounts) => {
      if (!alive) return;
      setAccounts(nextAccounts);
      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, []);

  const visibleAccounts = useMemo(
    () => mergeCurrentAccount(accounts),
    [accounts],
  );

  const handleSwitch = async (account: SwitchAccount) => {
    if (account.id === activeId || !account.sessionToken) return;

    setError(null);
    setPendingToken(account.sessionToken);
    const switched = await switchAccount(account.sessionToken);
    if (switched) return;

    setError(
      "Couldn’t switch accounts. That session may have expired. The account list has been refreshed.",
    );
    await refreshAccounts();
    setPendingToken(null);
  };

  const handleRemove = async (account: SwitchAccount) => {
    if (account.id === activeId) {
      setShowSignOut(true);
      return;
    }
    if (!account.sessionToken) return;

    setError(null);
    setPendingToken(account.sessionToken);
    const removed = await removeAccount(account.sessionToken);
    if (!removed) {
      setError(
        "Couldn’t sign out that account. Its session may have expired. The account list has been refreshed.",
      );
    }
    await refreshAccounts();
    setPendingToken(null);
  };

  const handleSignOutAll = async () => {
    setError(null);
    setSigningOutAll(true);
    const signedOut = await handleHardReset();
    if (!signedOut) setSigningOutAll(false);
  };

  const handleAddPasskey = async () => {
    setPasskeyError(null);
    setPasskeyMessage(null);
    setPasskeyPending("add");

    try {
      const { error } = await authClient.passkey.addPasskey();
      if (error) {
        setPasskeyError(error.message || "Couldn’t add the passkey.");
        return;
      }

      await refetchPasskeys();
      setPasskeyMessage("Passkey added.");
    } catch (error) {
      setPasskeyError(
        error instanceof Error ? error.message : "Couldn’t add the passkey.",
      );
    } finally {
      setPasskeyPending(null);
    }
  };

  const handleRemovePasskey = async (id: string) => {
    setPasskeyError(null);
    setPasskeyMessage(null);
    setPasskeyPending(id);

    try {
      const { error } = await authClient.passkey.deletePasskey({ id });
      if (error) {
        setPasskeyError(error.message || "Couldn’t remove the passkey.");
        return;
      }

      await refetchPasskeys();
    } catch (error) {
      setPasskeyError(
        error instanceof Error
          ? error.message
          : "Couldn’t remove the passkey.",
      );
    } finally {
      setPasskeyPending(null);
    }
  };

  return (
    <SettingsSectionShell
      title="Accounts"
      description="Switch, add, or sign out accounts on this device."
    >
      <SettingsCard title="Signed-in accounts">
        <div className="flex flex-col">
          {loading ? (
            <p className="border-b border-light-black-border-1 px-2 py-3 text-dense font-medium text-text-light-gray">
              Loading accounts…
            </p>
          ) : (
            visibleAccounts.map((account) => {
              const isActive = account.id === activeId;
              const label = account.name ?? account.email ?? "Account";
              const isPending = pendingToken === account.sessionToken;

              return (
                <div
                  className="flex items-center gap-3 border-b border-light-black-border-1 px-2 py-3"
                  key={account.sessionToken || `current-${account.id}`}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none disabled:cursor-default"
                    disabled={
                      isActive || !account.sessionToken || Boolean(pendingToken)
                    }
                    onClick={() => void handleSwitch(account)}
                    type="button"
                  >
                    <UserAvatar
                      alt=""
                      name={label}
                      photoURL={account.image}
                      size={40}
                      title={label}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-dense font-semibold text-white-black">
                        {isPending ? "Working…" : label}
                      </span>
                      <span className="block truncate text-meta font-medium text-text-light-gray">
                        {account.email}
                      </span>
                    </span>
                  </button>
                  {isActive && (
                    <span className="shrink-0 text-meta font-semibold text-text-light-gray">
                      Current
                    </span>
                  )}
                  <button
                    className={settingsActionButtonClass}
                    disabled={Boolean(pendingToken)}
                    onClick={() => void handleRemove(account)}
                    type="button"
                  >
                    Sign out
                  </button>
                </div>
              );
            })
          )}

          <button
            className="flex w-full items-center gap-3 px-2 py-3 text-left text-dense font-semibold text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
            onClick={addAccount}
            type="button"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-active-modal-element">
              <MdAdd size={18} />
            </span>
            Add account
          </button>
        </div>
      </SettingsCard>

      {error && (
        <p className="text-dense font-medium text-red-400" role="alert">
          {error}
        </p>
      )}

      <SettingsCard title="Passkeys">
        <div className="flex flex-col">
          {passkeysLoading ? (
            <p className="border-b border-light-black-border-1 px-2 py-3 text-dense font-medium text-text-light-gray">
              Loading passkeys…
            </p>
          ) : (
            passkeys?.map((passkey) => (
              <div
                className="flex items-center justify-between gap-4 border-b border-light-black-border-1 px-2 py-3"
                key={passkey.id}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-dense font-semibold text-white-black">
                    {passkey.name || "Passkey"}
                  </span>
                  <span className="block text-meta font-medium text-text-light-gray">
                    Added {new Date(passkey.createdAt).toLocaleDateString()}
                  </span>
                </span>
                <button
                  className={settingsActionButtonClass}
                  disabled={Boolean(passkeyPending)}
                  onClick={() => void handleRemovePasskey(passkey.id)}
                  type="button"
                >
                  {passkeyPending === passkey.id ? "Removing…" : "Remove"}
                </button>
              </div>
            ))
          )}

          {passkeysSupported === false ? (
            <p className="px-2 py-3 text-dense font-medium text-text-light-gray">
              Passkeys aren’t supported in this browser.
            </p>
          ) : passkeysSupported ? (
            <button
              className="flex w-full items-center gap-3 px-2 py-3 text-left text-dense font-semibold text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-light-gray"
              disabled={Boolean(passkeyPending)}
              onClick={() => void handleAddPasskey()}
              type="button"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-active-modal-element">
                <MdAdd size={18} />
              </span>
              {passkeyPending === "add" ? "Adding passkey…" : "Add a passkey"}
            </button>
          ) : null}
        </div>
      </SettingsCard>

      {passkeyError && (
        <p className="text-dense font-medium text-red-400" role="alert">
          {passkeyError}
        </p>
      )}
      {passkeyMessage && (
        <p className="text-dense font-medium text-text-light-gray" role="status">
          {passkeyMessage}
        </p>
      )}

      <SettingsCard>
        <div className="flex items-center justify-between gap-4 border-t border-light-black-border-1 px-2 py-3">
          <span className="text-dense font-semibold text-white-black">
            Sign out of every account on this device
          </span>
          <button
            className={settingsActionButtonClass}
            disabled={signingOutAll}
            onClick={() => void handleSignOutAll()}
            type="button"
          >
            {signingOutAll ? "Signing out…" : "Sign out of all accounts"}
          </button>
        </div>
      </SettingsCard>

      {showSignOut && (
        <SignOutModal closeHandler={() => setShowSignOut(false)} />
      )}
    </SettingsSectionShell>
  );
};

export default AccountsSection;
