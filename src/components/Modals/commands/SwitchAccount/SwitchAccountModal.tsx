import { ModalContainerCustom } from "@/components/Common/CommonModalComponents";
import { ModalHeader, ModalBody } from "reactstrap";
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import UserAvatar from "@/components/Common/UserAvatar";
import { IoIosClose } from "react-icons/io";
import { MdAdd, MdCheckCircle } from "react-icons/md";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import {
  listAccounts,
  getActiveAccountId,
  mergeCurrentAccount,
  switchAccount,
  addAccount,
  SwitchAccount,
} from "@/lib/auth/accounts";

interface ISwitchAccountModal {
  closeHandler: () => void;
}

const SwitchAccountModal: React.FC<ISwitchAccountModal> = ({ closeHandler }) => {
  const isMbl = useContext(MobileViewContext);
  const [accounts, setAccounts] = useState<SwitchAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingToken, setSwitchingToken] = useState<string | null>(null);
  const activeId = getActiveAccountId();

  const refreshAccounts = useCallback(async () => {
    const list = await listAccounts();
    setAccounts(list);
    setLoading(false);
    return list;
  }, []);

  useEffect(() => {
    let alive = true;
    listAccounts().then((list) => {
      if (!alive) return;
      setAccounts(list);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Always show the account you're currently signed in as, even if its session
  // predates multi-session and so isn't in listDeviceSessions yet.
  const items = useMemo<SwitchAccount[]>(
    () => mergeCurrentAccount(accounts),
    [accounts],
  );

  const handleSwitch = useCallback(
    async (account: SwitchAccount) => {
      if (account.id === activeId || !account.sessionToken) {
        closeHandler();
        return;
      }

      setError(null);
      setSwitchingToken(account.sessionToken);
      const switched = await switchAccount(account.sessionToken);
      if (switched) return;

      setError(
        "Couldn’t switch accounts. That session may have expired. The account list has been refreshed.",
      );
      await refreshAccounts();
      setSwitchingToken(null);
    },
    [activeId, closeHandler, refreshAccounts],
  );

  // While the picker is open, plain number keys 1-9 select an account.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

      const targetElement = e.target as HTMLElement | null;
      const targetTag = targetElement?.tagName?.toLowerCase();
      if (
        targetTag === "input" ||
        targetTag === "textarea" ||
        targetElement?.isContentEditable ||
        targetElement?.closest('[contenteditable="true"]')
      ) {
        return;
      }

      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const target = items[n - 1];
      if (!target) return;
      e.preventDefault();
      void handleSwitch(target);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [handleSwitch, items]);

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="switch-account-modal"
      toggle={closeHandler}
      shouldCloseOnClickOutside={true}
      contentClassName="h-full"
      fullScreen={isMbl}
      className="font-bold sm:max-h-[750px] border-none sm:w-full md:max-w-[380px] sm:min-w-[380px] flex flex-col"
    >
      <ModalHeader className="rounded-none border-b-0 h-[60px] pl-[24px] text-xl font-extrabold [&>*:first-child]:w-full">
        <div className="flex justify-between items-center w-full">
          <span className="text-lg">Switch account</span>
          <IoIosClose
            onClick={closeHandler}
            className="cursor-pointer"
            size={25}
          />
        </div>
      </ModalHeader>
      <ModalBody className="w-full border-b-0 border-transparent pt-0">
        <div className="flex flex-col gap-1">
          {loading ? (
            <p className="font-light text-sm px-2 py-3 opacity-60">Loading…</p>
          ) : items.length <= 1 ? (
            <p className="font-light text-sm px-2 py-3 opacity-80">
              Only this account is signed in. Add another to switch between them.
            </p>
          ) : (
            <p className="font-light text-xs px-2 pt-1 pb-2 opacity-60">
              Press 1-9 to switch.
            </p>
          )}
          {error && (
            <p className="px-2 pb-2 text-sm font-medium text-red-400" role="alert">
              {error}
            </p>
          )}
          {items.map((acc, idx) => {
            const isActive = acc.id === activeId;
            const label = acc.name ?? acc.email ?? "Account";
            return (
              <button
                key={acc.sessionToken || `current-${acc.id}`}
                disabled={Boolean(switchingToken)}
                onClick={() => void handleSwitch(acc)}
                className="flex items-center gap-3 w-full p-2 rounded-md hover:bg-active-elementBg text-left"
              >
                {idx < 9 && (
                  <kbd className="text-xs opacity-60 w-4 text-center shrink-0">
                    {idx + 1}
                  </kbd>
                )}
                <UserAvatar
                  alt=""
                  name={label}
                  photoURL={acc.image}
                  size={36}
                  title={label}
                />
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate">
                    {switchingToken === acc.sessionToken ? "Switching…" : label}
                  </span>
                  <span className="font-light text-xs truncate opacity-70">
                    {acc.email}
                  </span>
                </div>
                {isActive && (
                  <MdCheckCircle
                    className="ml-auto text-hypertasks-ai-purple shrink-0"
                    size={18}
                  />
                )}
              </button>
            );
          })}
          <button
            onClick={() => addAccount()}
            className="flex items-center gap-3 w-full p-2 mt-1 rounded-md hover:bg-active-elementBg text-left"
          >
            <div className="w-9 h-9 rounded-full flex items-center justify-center bg-active-modal-element shrink-0">
              <MdAdd size={20} />
            </div>
            <span className="font-medium">Add account</span>
          </button>
        </div>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default SwitchAccountModal;
