"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IoIosClose } from "react-icons/io";
import { ModalBody } from "reactstrap";
import {
  ModalContainerCustom,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents";
import { useSignout } from "@/hooks/MultiPages/HTC/useSignout";
import {
  getActiveAccountId,
  getCurrentAccount,
  listAccountsWithStatus,
  mergeCurrentAccount,
  signOutCurrentAccount,
  SwitchAccount,
} from "@/lib/auth/accounts";

interface SignOutModalProps {
  closeHandler: () => void;
}

const buttonClassName =
  "rounded-[5px] px-3 py-2 text-dense font-semibold transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-light-gray";

const accountLabel = (account: SwitchAccount | null | undefined) =>
  account?.email ?? account?.name ?? "this account";

const SignOutModal: React.FC<SignOutModalProps> = ({ closeHandler }) => {
  const { handleHardReset } = useSignout();
  const [accounts, setAccounts] = useState<SwitchAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [listUnavailable, setListUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const activeId = getActiveAccountId();

  const refreshAccounts = useCallback(async (clearErrorOnSuccess = false) => {
    const result = await listAccountsWithStatus();
    setAccounts(result.accounts);
    if (!result.ok) {
      setListUnavailable(true);
      setError("Couldn’t check the other signed-in accounts. Please try again.");
    } else if (clearErrorOnSuccess) {
      setListUnavailable(false);
      setError(null);
    } else {
      setListUnavailable(false);
    }
    setLoading(false);
    return result;
  }, []);

  useEffect(() => {
    let alive = true;
    listAccountsWithStatus().then((result) => {
      if (!alive) return;
      setAccounts(result.accounts);
      if (!result.ok) {
        setListUnavailable(true);
        setError(
          "Couldn’t check the other signed-in accounts. Please try again.",
        );
      }
      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeHandler();
    };

    document.addEventListener("keydown", handleKeydown, true);
    return () => document.removeEventListener("keydown", handleKeydown, true);
  }, [closeHandler]);

  const visibleAccounts = useMemo(
    () => mergeCurrentAccount(accounts),
    [accounts],
  );
  const currentAccount =
    visibleAccounts.find((account) => account.id === activeId) ??
    getCurrentAccount();
  const nextAccount = visibleAccounts.find(
    (account) => account.id !== activeId && Boolean(account.sessionToken),
  );

  const handleCurrentSignOut = async () => {
    if (listUnavailable) {
      setLoading(true);
      await refreshAccounts(true);
      return;
    }

    setError(null);
    setSubmitting(true);

    if (!nextAccount) {
      const signedOut = await handleHardReset();
      if (!signedOut) setSubmitting(false);
      return;
    }

    const signedOut = await signOutCurrentAccount(nextAccount.sessionToken);
    if (signedOut) return;

    setError(
      "Couldn’t sign out this account. Its session may have expired. Please try again.",
    );
    await refreshAccounts();
    setSubmitting(false);
  };

  const handleAllSignOut = async () => {
    setError(null);
    setSubmitting(true);
    const signedOut = await handleHardReset();
    if (!signedOut) setSubmitting(false);
  };

  return (
    <ModalContainerCustom
      autoFocus
      className="font-medium sm:min-w-[480px] sm:max-w-[480px] sm:top-[24%]"
      id="sign-out-modal"
      isOpen
      keyboard={false}
      shouldCloseOnClickOutside
      toggle={closeHandler}
    >
      <ModalHeaderComp header="Sign out" className="px-5">
        <button
          aria-label="Close"
          className="rounded-[5px] p-1 text-text-light-gray hover:bg-hover-active hover:text-white-black focus-visible:bg-hover-active focus-visible:outline-none"
          onClick={closeHandler}
          type="button"
        >
          <IoIosClose size={20} />
        </button>
      </ModalHeaderComp>
      <ModalBody className="px-6 pb-6 pt-2 text-white-black">
        {loading ? (
          <p className="py-3 text-dense text-text-light-gray">
            Checking signed-in accounts…
          </p>
        ) : (
          <>
            <p className="text-dense font-medium">
              {nextAccount
                ? `Sign out ${accountLabel(currentAccount)}? You’ll switch to ${accountLabel(nextAccount)}.`
                : `Sign out ${accountLabel(currentAccount)}?`}
            </p>
            {error && (
              <p className="mt-3 text-dense font-medium text-red-400" role="alert">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                className={buttonClassName}
                disabled={submitting}
                onClick={closeHandler}
                type="button"
              >
                Cancel
              </button>
              {nextAccount && (
                <button
                  className={buttonClassName}
                  disabled={submitting}
                  onClick={() => void handleAllSignOut()}
                  type="button"
                >
                  Sign out of all accounts
                </button>
              )}
              <button
                className={`${buttonClassName} bg-active-modal-element text-white-black`}
                disabled={submitting}
                onClick={() => void handleCurrentSignOut()}
                type="button"
              >
                {submitting
                  ? "Signing out…"
                  : listUnavailable
                    ? "Retry"
                    : `Sign out ${accountLabel(currentAccount)}`}
              </button>
            </div>
          </>
        )}
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default SignOutModal;
