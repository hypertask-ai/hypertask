"use client";

import { useEffect, useMemo, useState } from "react";
import { ModalBody } from "reactstrap";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  ModalContainerCustom,
  ModalFooterComp,
  ModalHeaderComp,
} from "@/components/Common/CommonModalComponents";
import SettingsToggle from "@/components/Modals/Settings/SettingsToggle";
import {
  type InboxQueryPayload,
  type InboxTabMeta,
} from "@/utils/helperFunctions/helperFunctions";
import { getInboxSplitKey, type InboxSplitKey } from "@/lib/inboxSplitSettings";
import {
  INBOX_QUERY_KEY,
  inboxDataQueryKey,
} from "@/hooks/Inbox/useGetNotifications";
import { updateInboxOptimistically } from "@/lib/inboxSync/optimistic";

const TEXT_ACTION_CLASS =
  "inline-flex min-h-7 items-center rounded-[4px] border-0 px-2 py-1 text-meta font-medium text-white-black transition-colors hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none";

type ManageSplitsModalProps = {
  userId: number;
  onClose: () => void;
  splitsNoImportant: InboxSplitKey[];
  tabs: InboxTabMeta[];
};

const ManageSplitsModal = ({
  userId,
  onClose,
  splitsNoImportant,
  tabs,
}: ManageSplitsModalProps) => {
  const queryClient = useQueryClient();
  const inboxQueryKey = inboxDataQueryKey(userId);
  const [mutedKeys, setMutedKeys] = useState(splitsNoImportant);
  const [savingKey, setSavingKey] = useState<InboxSplitKey | null>(null);

  useEffect(() => setMutedKeys(splitsNoImportant), [splitsNoImportant]);

  const manageableTabs = useMemo(
    () =>
      tabs.filter(
        (tab) => tab.projectId != null || tab.project === "@Mentions",
      ),
    [tabs],
  );

  const toggleSplit = async (tab: InboxTabMeta) => {
    if (savingKey) return;

    const splitKey = getInboxSplitKey(tab);
    const previousKeys = mutedKeys;
    const nextKeys = previousKeys.includes(splitKey)
      ? previousKeys.filter((key) => key !== splitKey)
      : [...previousKeys, splitKey];
    const previousInbox =
      queryClient.getQueryData<InboxQueryPayload>(inboxQueryKey);

    setMutedKeys(nextKeys);
    setSavingKey(splitKey);
    if (previousInbox) {
      updateInboxOptimistically({
        queryClient,
        queryKey: inboxQueryKey,
        accountId: userId,
        mutation: {
          type: "set_splits",
          splitsNoImportant: nextKeys,
        },
      });
    }

    try {
      const response = await fetch("/api/notifications/splits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ splitsNoImportant: nextKeys }),
      });
      if (!response.ok) throw new Error("Unable to save split settings");

      await queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
    } catch (error) {
      setMutedKeys(previousKeys);
      if (previousInbox) {
        updateInboxOptimistically({
          queryClient,
          queryKey: inboxQueryKey,
          accountId: userId,
          mutation: {
            type: "set_splits",
            splitsNoImportant: previousInbox.splitsNoImportant,
          },
        });
      }
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save split settings",
      );
      await queryClient.invalidateQueries({
        queryKey: inboxQueryKey,
        exact: true,
      });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <ModalContainerCustom
      fade={false}
      show
      isOpen
      id="manageSplitsModal"
      toggle={onClose}
      shouldCloseOnClickOutside
      contentClassName="rounded-[4px] border-0 bg-modalBackground"
      className="rounded-[4px] font-bold sm:min-w-[520px] sm:max-w-[560px] sm:top-[250px] xs:max-h-[450px] sm:max-h-[450px]"
    >
      <ModalHeaderComp
        header="Manage inbox splits"
        subHeadline="Eligible messages from a split also appear in Important. Everything else stays only in its split."
        subHeadlineClassName="block text-content font-normal text-text-light-gray"
        className="!h-auto border-none px-5 pb-3 pt-4"
        headerClassName="!h-auto p-0"
      />
      <ModalBody className="max-h-[360px] overflow-y-auto px-5 pb-4 pt-0">
        <p className="mb-3 text-micro font-normal leading-relaxed text-text-light-gray">
          Eligible: @mentions of you, assignments, reminders, tasks moved to
          your inbox, and comments, description edits, or overdue alerts on
          tasks assigned to you.
        </p>
        <ul className="space-y-1.5">
          {manageableTabs.map((tab) => {
            const splitKey = getInboxSplitKey(tab);
            return (
              <li
                className="flex min-h-12 items-center justify-between gap-4 rounded-[5px] bg-cardBackground px-3 py-2.5 text-content transition-colors hover:bg-hover-active"
                key={splitKey}
              >
                <span className="min-w-0 truncate text-[13.5px] font-semibold text-white-black">
                  {tab.project}
                </span>
                <div className="shrink-0 [&>div]:gap-3 [&>div]:px-0 [&_label]:font-normal">
                  <SettingsToggle
                    checked={!mutedKeys.includes(splitKey)}
                    disabled={savingKey !== null}
                    inputId={`also-important-${splitKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                    label="Also show in Important"
                    onChange={() => void toggleSplit(tab)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </ModalBody>
      <ModalFooterComp className="m-0 justify-end px-5 pb-4 pt-0">
        <button type="button" className={TEXT_ACTION_CLASS} onClick={onClose}>
          Done
        </button>
      </ModalFooterComp>
    </ModalContainerCustom>
  );
};

export default ManageSplitsModal;
