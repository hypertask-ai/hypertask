"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { ModalContainerCustom } from "@/components/Common/CommonModalComponents";
import SelectionCheckbox from "@/components/Common/selection-checkbox";
import SettingsToggle from "@/components/Modals/Settings/SettingsToggle";
import useInboxZeroActions, {
  InboxZeroPreviewChangedError,
} from "@/hooks/Inbox/useInboxZeroActions";
import {
  DEFAULT_INBOX_ZERO_RULES,
  INBOX_ZERO_THRESHOLD_OPTIONS,
  type InboxZeroCategories,
  type InboxZeroKeep,
  type InboxZeroPreview,
  type InboxZeroRules,
  type InboxZeroThresholdDays,
} from "@/lib/inboxZero";

type InboxZeroSheetProps = {
  onClose: () => void;
  /** Which rules the sheet opens on. The palette has a command per preset. */
  initialRules?: InboxZeroRules;
};

type InboxZeroSheetContentProps = InboxZeroSheetProps & {
  executeInboxZero: (
    rules: InboxZeroRules,
    previewVersion: string
  ) => Promise<unknown>;
};

const emptyPreview: InboxZeroPreview = {
  categoryCounts: {
    read: 0,
    reactions: 0,
    ownActions: 0,
    superseded: 0,
    pastReminders: 0,
  },
  totalActive: 0,
  totalToArchive: 0,
  totalLeft: 0,
  previewVersion: "",
};

const categoryRows: Array<{
  key: keyof InboxZeroCategories;
  label: string;
}> = [
  { key: "reactions", label: "Reactions" },
  { key: "ownActions", label: "Your own actions" },
  { key: "superseded", label: "Superseded moves & edits" },
  { key: "pastReminders", label: "Past reminders on done tasks" },
];

const keepRows: Array<{ key: keyof InboxZeroKeep; label: string }> = [
  { key: "unread", label: "Keep unread" },
  { key: "mentions", label: "Keep @mentions" },
  { key: "assignments", label: "Keep assignments" },
];

export const InboxZeroSheetContent = ({
  onClose,
  initialRules = DEFAULT_INBOX_ZERO_RULES,
  executeInboxZero,
}: InboxZeroSheetContentProps) => {
  const [threshold, setThreshold] = useState<InboxZeroThresholdDays>(
    initialRules.threshold
  );
  const [categories, setCategories] = useState<InboxZeroCategories>({
    ...initialRules.categories,
  });
  const [keep, setKeep] = useState<InboxZeroKeep>({ ...initialRules.keep });
  const [preview, setPreview] = useState<InboxZeroPreview>(emptyPreview);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRequest, setPreviewRequest] = useState(0);
  const [executing, setExecuting] = useState(false);
  const rules = useMemo<InboxZeroRules>(
    () => ({ threshold, categories, keep }),
    [categories, keep, threshold]
  );
  const thresholdLabel =
    INBOX_ZERO_THRESHOLD_OPTIONS.find((option) => option.days === threshold)
      ?.label ?? "1 week";
  const actionLabel =
    preview.totalToArchive === 0
      ? "No Inbox items to archive"
      : preview.totalLeft === 0
      ? "Clear to Zero"
      : `Archive ${preview.totalToArchive} Inbox item${
          preview.totalToArchive === 1 ? "" : "s"
        }`;

  useEffect(() => {
    const controller = new AbortController();
    setPreviewLoading(true);
    setPreviewError(null);

    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/notifications/inbox-zero/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rules),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to preview Inbox Zero");
        setPreview((await response.json()) as InboxZeroPreview);
      } catch (error) {
        if (controller.signal.aborted) return;
        const message =
          error instanceof Error ? error.message : "Unable to preview Inbox Zero";
        setPreview(emptyPreview);
        setPreviewError(message);
        toast.error(message);
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }, 120);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [previewRequest, rules]);

  const toggleCategory = (key: keyof InboxZeroCategories) => {
    setCategories((current) => ({ ...current, [key]: !current[key] }));
  };

  const toggleKeep = (key: keyof InboxZeroKeep) => {
    setKeep((current) => ({ ...current, [key]: !current[key] }));
  };

  const execute = async () => {
    if (
      executing ||
      previewLoading ||
      previewError ||
      preview.totalToArchive === 0 ||
      !preview.previewVersion
    ) {
      return;
    }
    setExecuting(true);
    try {
      await executeInboxZero(rules, preview.previewVersion);
      onClose();
    } catch (error) {
      if (error instanceof InboxZeroPreviewChangedError) {
        setPreview(error.preview);
        toast.error(error.message);
        setExecuting(false);
        return;
      }
      toast.error(
        error instanceof Error ? error.message : "Unable to clear the inbox"
      );
      setExecuting(false);
    }
  };

  return (
    <ModalContainerCustom
      contentClassName="overflow-hidden rounded-[5px]"
      fade={false}
      id="inbox-zero-sheet"
      isOpen
      show
      className="sm:!min-w-[540px] sm:!top-[14%]"
      toggle={onClose}
    >
      <div className="bg-modalBackground text-white-black">
        <div className="border-b border-light-black-border-1 px-5 py-4">
          <h2 className="text-emphasis font-semibold">Get to Inbox Zero</h2>
          <p className="mt-1 text-dense text-text-light-gray">
            Archive visible Inbox items that no longer need you. Undoable.
          </p>
        </div>

        <div className="max-h-[62vh] overflow-y-auto px-5 py-3 text-dense no-scrollbar">
          <div className="flex items-center justify-between gap-4 border-b border-light-black-border-1 py-3">
            <span className="font-medium">Archive read notifications older than</span>
            <select
              aria-label="Read notification age"
              className="cursor-pointer rounded-[4px] border-0 bg-active-modal-element px-2 py-1 font-semibold text-white-black outline-none"
              onChange={(event) =>
                setThreshold(Number(event.target.value) as InboxZeroThresholdDays)
              }
              value={threshold}
            >
              {INBOX_ZERO_THRESHOLD_OPTIONS.map((option) => (
                <option key={option.days} value={option.days}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="py-2">
            <RuleRow
              checked={categories.read}
              count={preview.categoryCounts.read}
              label={`Read & older than ${thresholdLabel}`}
              onToggle={() => toggleCategory("read")}
            />
            {categoryRows.map((row) => (
              <RuleRow
                checked={categories[row.key]}
                count={preview.categoryCounts[row.key]}
                key={row.key}
                label={row.label}
                onToggle={() => toggleCategory(row.key)}
              />
            ))}
          </div>

          <div className="border-t border-light-black-border-1 py-2">
            {keepRows.map((row) => (
              <div
                className="flex min-h-[36px] items-center justify-between gap-4 px-2"
                key={row.key}
              >
                <span className="font-medium">{row.label}</span>
                <div className="[&>div]:min-h-0 [&>div]:p-0">
                  <SettingsToggle
                    checked={keep[row.key]}
                    hideLabel
                    inputId={`inbox-zero-keep-${row.key}`}
                    label={row.label}
                    onChange={() => toggleKeep(row.key)}
                  />
                </div>
              </div>
            ))}
          </div>

          <p
            aria-live="polite"
            className="border-t border-light-black-border-1 px-2 pt-3 font-medium text-text-light-gray"
          >
            {previewLoading
              ? "Calculating preview…"
              : previewError
                ? "Preview unavailable."
                : `Will archive ${preview.totalToArchive} of ${preview.totalActive} visible Inbox items · ${preview.totalLeft} left`}
            {previewError && (
              <button
                className="ml-2 underline underline-offset-2"
                onClick={() => setPreviewRequest((current) => current + 1)}
                type="button"
              >
                Retry
              </button>
            )}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-light-black-border-1 px-5 py-3">
          <button
            className="btn btn-secondary btn-sm rounded-[4px]"
            disabled={executing}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm rounded-[4px]"
            disabled={
              executing ||
              previewLoading ||
              Boolean(previewError) ||
              preview.totalToArchive === 0
            }
            onClick={() => void execute()}
            type="button"
          >
            {executing ? "Archiving…" : actionLabel}
          </button>
        </div>
      </div>
    </ModalContainerCustom>
  );
};

const InboxZeroSheet = (props: InboxZeroSheetProps) => {
  const { executeInboxZero } = useInboxZeroActions();

  return (
    <InboxZeroSheetContent
      {...props}
      executeInboxZero={executeInboxZero}
    />
  );
};

const RuleRow = ({
  checked,
  count,
  label,
  onToggle,
}: {
  checked: boolean;
  count: number;
  label: string;
  onToggle: () => void;
}) => (
  <div className="flex min-h-[36px] w-full items-center gap-3 rounded-[4px] px-2 hover:bg-hover-active">
    <SelectionCheckbox
      alwaysVisible
      borderColorClass="!border-icon-dark-gray"
      className="!flex"
      isChecked={checked}
      onClick={onToggle}
    />
    <button
      aria-checked={checked}
      className="flex min-h-[36px] min-w-0 flex-1 items-center gap-3 text-left"
      onClick={onToggle}
      role="checkbox"
      type="button"
    >
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <span className="shrink-0 text-text-light-gray">{count}</span>
    </button>
  </div>
);

export default InboxZeroSheet;
