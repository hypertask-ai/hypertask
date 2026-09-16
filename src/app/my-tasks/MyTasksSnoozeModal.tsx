"use client";

import { ModalBody } from "reactstrap";
import { ChangeEvent, useContext, useEffect, useMemo, useState } from "react";
import { useRecoilState } from "@/lib/state";
import { lastUsedReminderAtom } from "@/store";
import styles from "@/styles/linksModal.module.scss";
import {
  ModalContainerCustom,
  ModalInput,
} from "@/components/Common/CommonModalComponents";
import { inputChange } from "@/utils/helperFunctions/dateParse";
import useGetTimeOptions from "@/hooks/General/useGetTimeOptions";
import { Clock, Search } from "lucide-react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { MobileBottomSheet } from "@/components/Modals/Sheets";
import { useFlag } from "@/hooks/useFlag";
import { MY_TASKS_SNOOZE_FLAG } from "@/lib/flags/keys";
import formatDateDifference from "@/utils/generateTime";
import toast from "react-hot-toast";

type DisplayDate = {
  display: string;
  date: unknown;
};

type Props = {
  closeHandler: (refresh?: boolean) => void;
  onPickDate: (date: string) => void | Promise<void>;
};

/** HTPR-6461: My Tasks date picker using the same Remind Me presets. */
const MyTasksSnoozeModal = ({ closeHandler, onPickDate }: Props) => {
  const snoozeEnabled = useFlag(MY_TASKS_SNOOZE_FLAG);
  const [lastUsedReminder, setLastUsedReminder] = useRecoilState(lastUsedReminderAtom);
  const { getRemindMeOptions } = useGetTimeOptions();
  const defaultOptions = useMemo(
    () => getRemindMeOptions(lastUsedReminder) as DisplayDate[],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- freeze presets when the modal opens
    [],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [filteredOptions, setFilteredOptions] = useState<DisplayDate[]>(defaultOptions);
  const _mbl = useContext(MobileViewContext);
  const mobileSafeAreaEnabled = useFlag("htpr-6130-mobile-reminder-safe-area");

  useEffect(() => {
    if (!snoozeEnabled) closeHandler();
  }, [closeHandler, snoozeEnabled]);

  useEffect(() => {
    if (!snoozeEnabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void pick(selectedIndex);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeHandler();
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) =>
          Math.min(index + 1, Math.max(filteredOptions.length - 1, 0)),
        );
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target.value;
    setUserInput(input);
    setSelectedIndex(0);
    const final = inputChange(input, { past: false, future: true }) as DisplayDate[];
    setFilteredOptions(
      final.length > 0
        ? final
        : defaultOptions.filter((option) =>
            option.display.toLowerCase().startsWith(input.toLowerCase()),
          ),
    );
  };

  const pick = async (index: number) => {
    const option = filteredOptions[index];
    if (!option?.date) return;
    try {
      const iso =
        typeof option.date === "string"
          ? option.date
          : new Date(option.date as string | number | Date).toISOString();
      if (!Number.isFinite(new Date(iso).getTime())) {
        toast.error("Could not save that date. Try again.");
        return;
      }
      await onPickDate(iso);
      setLastUsedReminder({ date: option.date as string, display: "last used" });
      closeHandler(true);
    } catch (error) {
      console.error("My Tasks snooze failed:", error);
      toast.error("Could not snooze that task. Try again.");
    }
  };

  const optionButton = (option: DisplayDate, index: number) => (
    <button
      key={`snooze-${option.display}-${index}`}
      type="button"
      role="option"
      aria-selected={index === selectedIndex}
      onMouseEnter={() => setSelectedIndex(index)}
      onClick={() => void pick(index)}
      className={`flex min-h-[44px] w-full cursor-pointer items-center gap-3 border-b border-light-black-border-1 px-4 text-left text-content transition-colors duration-75 ${
        index === selectedIndex ? "bg-active-modal-element" : ""
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-label-span text-text-light-gray">
        <Clock size={16} strokeWidth={1.5} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-white-black">{option.display}</span>
      {option.date ? (
        <span className="shrink-0 text-meta text-text-light-gray">
          {formatDateDifference(option.date as string, true)}
        </span>
      ) : null}
    </button>
  );

  const searchField = (
    <div className="flex items-center gap-2 border-light-black-border-1 px-4">
      <Search strokeWidth={1.5} size={16} className="shrink-0 text-text-light-gray" />
      <ModalInput
        autoFocus
        onChange={handleInputChange}
        value={userInput}
        placeholder="e.g. tomorrow, next week"
        className="px-0"
      />
    </div>
  );

  if (!snoozeEnabled) {
    return <span hidden data-htpr-6461-my-tasks-snooze />;
  }

  if (_mbl) {
    return (
      <MobileBottomSheet
        isOpen
        onClose={() => closeHandler()}
        ariaLabel="Snooze until"
        fullHeight
        keyboardAware
        bottomSafeAreaFloor={mobileSafeAreaEnabled}
        bottomSlot={<div className="border-t border-light-black-border-1">{searchField}</div>}
      >
        <h3 className="px-4 pb-1 pt-2 text-micro font-semibold uppercase tracking-wider text-text-light-gray">
          Snooze until
        </h3>
        <div role="listbox">{filteredOptions.map(optionButton)}</div>
      </MobileBottomSheet>
    );
  }

  return (
    <ModalContainerCustom
      id="myTasksSnoozeModal"
      isOpen
      toggle={() => closeHandler()}
      autoFocus={false}
      keyboard={false}
      className={`paletteModalSizing sm:max-h-fit sm:top-[24%] sm:min-w-[560px] ${styles.links_modal}`}
      contentClassName="rounded-[5px] overflow-hidden"
    >
      <ModalBody className="p-0 rounded-[5px]">
        <div className="border-b border-light-black-border-1">{searchField}</div>
        <div className="max-h-[364px] overflow-y-scroll bg-inherit pb-1.5 no-scrollbar">
          <h3 className="px-4 pb-1 pt-2 text-micro font-semibold uppercase tracking-wider text-text-light-gray">
            Snooze until
          </h3>
          <div role="listbox">{filteredOptions.map(optionButton)}</div>
        </div>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default MyTasksSnoozeModal;
