import { currentUserAtom, inViewObjectAtom, lastUsedReminderAtom } from "@/store";
import { ChangeEvent, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ModalBody } from "reactstrap";
import { useRecoilState } from "@/lib/state";
import styles from '@/styles/linksModal.module.scss'
import { IRemindAll, IUser } from "@/models/model";

import formatDateDifference from "@/utils/generateTime";
import toast from "react-hot-toast";
// const Sugar:any = dynamic(()=>import("sugar").then(x=>x.default()))
import useGlobalFocusHandler from "@/hooks/Inbox/useGlobalFocusHandler";
import { ModalContainerCustom, ModalHintBar, ModalInput, ModalRowElementContainer } from "@/components/Common/CommonModalComponents";
import { inputChange } from "@/utils/helperFunctions/dateParse";
import useGetTimeOptions from "@/hooks/General/useGetTimeOptions";
import { reminderDropOptions } from "@/lib/constants/constants";
import { ChevronDown, CircleCheck, Clock, Search } from "lucide-react";

import { MobileViewContext } from "@/lib/contexts/mobileContext";
import useQueryState from "@/hooks/MultiPages/useQueryState";
import { MobileBottomSheet } from "@/components/Modals/Sheets";

// Bulk action interface for better type safety
export interface BulkActionInbox {
  taskId: number;
  projectId?: number;
  // Add any other properties you need for bulk actions
}

type Props = {
  closeHandler: (refresh?: boolean) => void;
  remindTask?: boolean;
  // New props for bulk actions
  isBulkMode?: boolean;
  bulkItems?: BulkActionInbox[];
}

export interface DisplayDate {
  display: string;
  date: any;
  default?: boolean;
}

const RemindMeComponent = (props: Props) => {
  const { closeHandler, remindTask, isBulkMode = false, bulkItems = [] } = props
  const taskRef = useRef<HTMLDivElement>(null);
  const [inViewObject, __] = useRecoilState(inViewObjectAtom);
  const [currentUser, ____] = useRecoilState(currentUserAtom);
  const currentHoveredDiv = useRef<number | null>(null);
  const [lastUsedReminder, setLastUsedReminder] = useRecoilState(lastUsedReminderAtom)
  const [reminderOptionSelected, setReminderOptionSelected] = useQueryState<IRemindAll>(["reminder option [userId]:", currentUser?.id.toString()], reminderDropOptions[0]);  
  const { getRemindMeOptions } = useGetTimeOptions()
  // const blurTimeout = useRef<NodeJS.Timeout | null>(null);
  const defaultOptions: any[] = useMemo(()=>getRemindMeOptions(lastUsedReminder),[])

  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const { archiveNotificationGetter } = useGlobalFocusHandler()

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  // const [label, setLabel] = useState('')
  // const [currentScreen, _] = useState<"Remind Me">("Remind Me")
  const [modal, ___] = useState<boolean>(true);
  const [filteredOptions, setFilteredOptions] = useState<(DisplayDate | undefined)[]>(defaultOptions);
  const _mbl = useContext(MobileViewContext);
  
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target.value;
    setUserInput(input);
    setSelectedIndex(0)

    const final = inputChange(input, { past: false, future: true })
    setFilteredOptions((final.length > 0) ? final : defaultOptions.filter(x => x.display.toLowerCase().startsWith(input)));
  };

  const handleDropDownCallback = (option: IRemindAll) => setReminderOptionSelected(option)

  const handleToggle = () => {
    // setModal(!modal)
    closeHandler()
  }
  
  // -------------------- ON MODAL LOAD, for focus
  const onOpenHandler = async () => {
    // setLoading(true)
    setSelectedIndex(0)
  }

  // =================== create label and assign - Updated for bulk actions
  const createReminder = async (index: number, click = false) => {
    let fIndex = click ? index : selectedIndex
    if (index >= filteredOptions.length || !filteredOptions[fIndex] || !filteredOptions[fIndex]?.date) {
      return;
    }

    const reminderDate = filteredOptions[fIndex]?.date;
    const reminderType = reminderOptionSelected.type;

    // Handle bulk actions
    if (isBulkMode && bulkItems.length > 0) {
      const bulkPromises = bulkItems.map((action) => {
        // Each bulk/snooze item carries its own task + project; do NOT gate on
        // inViewObject (it points at the keyboard-focused row, which is null or a
        // different task when snoozing via swipe or a non-focused row — that made
        // the reminder silently no-op, leaving the task in the inbox). HTPR bug.
        const projectId = action.projectId ?? inViewObject.taskProjectId;
        if (!action.taskId || !projectId) {
          console.error("Invalid bulk reminder action (missing task or project):", action);
          return;
        }
        const body = {
          type: "Reminder",
          taskId: action.taskId,
          userId: currentUser?.id,
          projectId,
          remindAt: reminderDate,
          reminderOption: reminderType,
          remindTask: remindTask
        }
        return archiveNotificationGetter(body, "Remind", null)
      });

      try {
        await Promise.all(bulkPromises);
        console.log("🚀 ~ createBulkReminders ~ reminderOption, reminderDate", reminderType, reminderDate)
        
        setLastUsedReminder({ date: reminderDate!, display: "last used" })
        
        const taskCount = bulkItems.length;
        const taskText = taskCount === 1 ? "task" : "tasks";
        toast(`${taskCount} ${taskText} will reappear in inbox at ` + formatDateDifference(reminderDate!, true))
        
        closeHandler(true)
      } catch (error) {
        console.error("Error creating bulk reminders:", error);
        toast.error("Failed to create some reminders. Please try again.");
      }
    } else {
      // Handle single task reminder (original logic)
      const body = {
        type: "Reminder",
        taskId: inViewObject.taskId,
        userId: currentUser?.id,
        projectId: inViewObject.taskProjectId,
        remindAt: reminderDate,
        reminderOption: reminderType,
        remindTask: remindTask
      }
      
      console.log("🚀 ~ createReminder ~ reminderOption, reminderDate", reminderType, reminderDate)
      setLastUsedReminder({ date: reminderDate!, display: "last used" })
      archiveNotificationGetter(body, "Remind", null)
      
      toast("Task will reappear in inbox at " + formatDateDifference(reminderDate!, true))
      closeHandler(true)
    }
  }

  // -============================ handle keydown functions
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      createReminder(selectedIndex)
    }

    if (e.key === "Escape") {
      e.preventDefault()
      closeHandler()
    }
    if (e.key === "Tab") {
      e.preventDefault()
      return
    }
    if (e.key === "j" || e.key === "ArrowDown") {
      downHandler();
      return true;
    }

    if (e.key === "k" || e.key === "ArrowUp") {
      upHandler();
      return true;
    }
  }

  const upHandler = () => {
    if (filteredOptions.length === 0) return
    const selectedIdx = (selectedIndex + filteredOptions.length - 1) % filteredOptions.length
    setSelectedIndex(selectedIdx);
    document.getElementById(`option-${selectedIdx}`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  };

  const downHandler = () => {
    if (filteredOptions.length === 0) return
    const selectedIdx = (selectedIndex + 1) % filteredOptions.length
    setSelectedIndex(selectedIdx);
    document.getElementById(`option-${selectedIdx}`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  };

  const handleMouseLeave = () => {
    // Clear any existing debounceTimeout
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }

    // Start a new debounceTimeout to remove focus after a short delay (e.g., 100ms)
    debounceTimeout.current = setTimeout(() => {
      if (currentHoveredDiv.current !== null && taskRef.current) {
        (taskRef.current as HTMLDivElement)?.blur();
        currentHoveredDiv.current = null;
      }
    }, 100);
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, filteredOptions, reminderOptionSelected]);

  // Dynamic header text based on mode
  const getHeaderText = () => {
    if (isBulkMode && bulkItems.length > 0) {
      const taskCount = bulkItems.length;
      const taskText = taskCount === 1 ? "task" : "tasks";
      return `Remind Me (${taskCount} ${taskText})`;
    }
    return "Remind Me";
  };

  const mobileSearchInput = (
    <div className="flex items-center gap-2.5 border-t border-light-black-border-1 px-4">
      <Search strokeWidth={1.75} size={16} className="shrink-0 text-text-light-gray" />
      <ModalInput
        autoFocus
        onChange={handleInputChange}
        value={userInput}
        placeholder="e.g. 5 July 2pm, 8pm tomorrow"
        className="px-0"
      />
      <DropDownButton
        reminderSelected={reminderOptionSelected}
        optionCallback={handleDropDownCallback}
        _mbl={_mbl}
      />
    </div>
  );

  if (_mbl) {
    return (
      <MobileBottomSheet
        isOpen={modal}
        onClose={handleToggle}
        ariaLabel={getHeaderText()}
        fullHeight
        keyboardAware
        bottomSlot={mobileSearchInput}
      >
        <h3 className="px-4 pb-1 pt-2 text-micro font-semibold uppercase tracking-wider text-text-light-gray">
          {getHeaderText()}
        </h3>
        <ul id="users-list" role="listbox">
          {filteredOptions.map((option, index) => (
            <li
              id={`option-${index}`}
              key={`reminder-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => createReminder(index, true)}
              className={`flex min-h-[52px] cursor-pointer items-center gap-3 border-b border-light-black-border-1 px-4 text-content transition-colors duration-75 ${
                index === selectedIndex ? "bg-active-modal-element" : ""
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-label-span text-text-light-gray">
                <Clock size={16} strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-white-black">
                {option?.display}
              </span>
              {option?.date ? (
                <span className="shrink-0 text-meta text-text-light-gray">
                  {formatDateDifference(option.date, true)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </MobileBottomSheet>
    );
  }

  // =========================================================== FRONTEND COMPONENT ==================================
  return (
    <ModalContainerCustom
      // fade={false}
      id="assignModal"
      isOpen={modal}
      onOpened={onOpenHandler}
      toggle={handleToggle}
      autoFocus={false}
      keyboard={false}
      className={`paletteModalSizing sm:max-h-fit sm:top-[24%] sm:min-w-[560px] ${styles.links_modal}`}
      contentClassName="rounded-[5px] overflow-hidden"
    >
      <ModalBody className="p-0 rounded-[5px]">
        <div className="flex items-center gap-2.5 border-b border-light-black-border-1 px-4">
          <Search strokeWidth={1.75} size={13} className="shrink-0 text-text-light-gray" />
          <ModalInput
            onChange={handleInputChange}
            value={userInput}
            placeholder="e.g. 5 July 2pm, 8pm tomorrow, next Thursday"
            className="px-0"
          />
          <DropDownButton
            reminderSelected={reminderOptionSelected}
            optionCallback={handleDropDownCallback}
            _mbl={_mbl}
          />
        </div>

        <div className="max-h-[364px] overflow-y-scroll bg-inherit pb-1.5 no-scrollbar">
          <h3 className="px-4 pb-1 pt-2.5 text-micro font-semibold uppercase tracking-wider text-text-light-gray">
            {getHeaderText()}
          </h3>
          <ul id="users-list" role="listbox">
            {filteredOptions?.map((option, index: number) => (
              <ModalRowElementContainer
                id={`option-${index}`}
                index={index}
                handleMouseLeave={handleMouseLeave}
                onMouseEnter={() => setSelectedIndex(index)}
                key={`reminder-${index}`}
                isSelected={index === selectedIndex}
                aria-selected={index === selectedIndex}
                role="option"
                onClick={() => createReminder(index, true)}
              >
                <span className="min-w-0 truncate text-white-black">
                  {option?.display}
                </span>
                {option?.date && (
                  <span className="shrink-0 text-text-light-gray">
                    {formatDateDifference(option.date, true)}
                  </span>
                )}
              </ModalRowElementContainer>
            ))}
          </ul>
        </div>

        <ModalHintBar />
      </ModalBody>
    </ModalContainerCustom>
  )
}

const DropDownButton = ({
  optionCallback,
  reminderSelected,
  _mbl,
}: {
  reminderSelected: IRemindAll;
  optionCallback: (item: IRemindAll) => void;
  _mbl: boolean;
}) => {
  const [isActive, setIsActive] = useState<number>(0);
  const [isDropDown, setIsDropDown] = useState<boolean>(false);
  const [options, setOptions] = useState<IRemindAll[]>(reminderDropOptions);

  useEffect(() => {
    if (reminderSelected) {
      const item = reminderDropOptions.find(
        (item) => item.type === reminderSelected.type
      );
      if (item) {
        const reorderedOptions = [
          item,
          ...reminderDropOptions.filter(
            (option) => option.type !== reminderSelected.type
          ),
        ];
        setOptions(reorderedOptions);
      }
      return;
    }
  }, [isDropDown]);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-expanded={isDropDown}
        className="inline-block shrink-0 rounded-sm bg-active-modal-element px-3 py-1 text-content leading-normal text-white-black transition duration-75"
        onClick={() => {
          setIsDropDown((prev) => !prev);
          setIsActive(0);
        }}
      >
        <div className="flex w-[120px] items-center justify-between gap-2">
          <span className="truncate">{reminderSelected?.display}</span>
          <ChevronDown size={16} strokeWidth={1.75}
            className={`mr-[-10px] flex-none p-0 text-white-black ${
              isDropDown ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {isDropDown && (
        <div className={`absolute right-0 z-10 ${_mbl ? "bottom-full mb-2 w-[10rem]" : "mt-2 w-[12rem]"} max-h-[14rem] overflow-y-auto rounded-[5px] bg-modalBackground py-1.5 shadow-customshadow-2 scrollbar-thin`}>
          <ul>
            {options.map((option, index) => (
              <li
                key={`ai-option-label-${index}`}
                className={`mx-1.5 flex h-[36px] cursor-pointer items-center justify-between gap-1 rounded-sm px-3 text-dense transition-all duration-75 ${
                  isActive === index ? "bg-active-modal-element" : ""
                }`}
                onMouseOver={() => setIsActive(index)}
                onClick={() => {
                  setIsDropDown((prev) => !prev);
                  optionCallback(option);
                  setIsActive(0);
                }}
              >
                <span className="flex min-w-0 items-center truncate text-white-black">{option.display}</span>

                {option.type === reminderSelected?.type ? (
                  <CircleCheck size={16} strokeWidth={1.75}
                    className="m-0 flex-none p-0 text-white-black"
                  />
                ) : (
                  <></>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default RemindMeComponent;
