/* eslint-disable react-hooks/exhaustive-deps */
import {
  ModalContainerCustom,
  ModalHeaderComp,
  ModalInput,
  ModalListContainer,
  ModalRowElementContainer,
} from "@/components/Common/CommonModalComponents";
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { ModalBody } from "reactstrap";
import { inputChange } from "@/utils/helperFunctions/dateParse";
import formatDateDifference from "@/utils/generateTime";
import { useRecoilState } from "@/lib/state";
import { inViewObjectAtom } from "@/store";
import { useGetSingleTask } from "@/hooks/MultiPages/Tasks/useGetTask";
import { setStartDateApiHandler } from "@/utils/api/Task Detail";
import useGetTimeOptions from "@/hooks/General/useGetTimeOptions";
import toast from "react-hot-toast";

// HTPR-4884: start-date picker. Same natural-language flow as the due-date
// modal (Sugar parsing + presets), minus the custom-calendar second screen —
// a start date is nearly always "today"/"monday", not a far-off exact day.

type StartDateMode = "Create" | "Update";

interface Props {
  closeHandler: (date: Date | null, reset?: boolean) => void;
  startDate?: Date;
  mode?: StartDateMode;
}

const StartDateModal: React.FC<Props> = ({
  closeHandler,
  startDate,
  mode = "Update",
}) => {
  const [inViewObject] = useRecoilState(inViewObjectAtom);
  const taskId = mode === "Update" ? inViewObject.taskId : null;
  const { data: task } = useGetSingleTask(taskId);
  const currentStartDate =
    mode === "Create" ? (startDate ?? null) : (task?.startDate ?? null);

  const { getDefaultOptions } = useGetTimeOptions();
  const [keyword, setKeyword] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });

  // Recomputed when the task query resolves: with a [] dep list, opening this
  // from a surface where the task isn't cached yet would miss the start date
  // and never offer "Reset".
  const defaultOptions: any[] = useMemo(
    () =>
      [
        currentStartDate ? { display: "Reset", date: undefined } : null,
        ...getDefaultOptions(),
      ].filter(Boolean),
    [currentStartDate],
  );
  const [filteredOptions, setFilteredOptions] = useState<any[]>(defaultOptions);

  // Keep the untyped list in step with those options once they arrive.
  useEffect(() => {
    if (keyword.length === 0) setFilteredOptions(defaultOptions);
  }, [defaultOptions]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target.value;
    setKeyword(input);
    setSelectedIndex(0);
    const parsed: any = inputChange(input, { past: true, future: true });
    setFilteredOptions(input.length === 0 ? defaultOptions : parsed);
  };

  const enterHandler = async (index: number) => {
    const selected = filteredOptions[index];
    if (!selected) return;
    const date = selected.date ? new Date(selected.date) : undefined;
    if (mode === "Update" && inViewObject.taskId) {
      try {
        const result = await setStartDateApiHandler(date, inViewObject.taskId);
        if (result === undefined) {
          toast.error("Could not update the start date. Try again.");
          return;
        }
      } catch {
        toast.error("Could not update the start date. Try again.");
        return;
      }
    }
    setTimeout(() => {
      if (date) closeHandler(date);
      else closeHandler(null, true);
    }, 1);
  };

  const move = (delta: number) => {
    const next = selectedIndex + delta;
    if (next < 0 || next > filteredOptions.length - 1) return;
    setSelectedIndex(next);
    document
      .getElementById(`start-date-option-${next}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    // Arrows only: this modal's whole point is a text field, so j/k have to
    // stay typeable (the due-date modal's bare keyCode check scrolls the list
    // when you type "june").
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      enterHandler(selectedIndex);
    } else if (event.key === "Escape") {
      closeHandler(currentStartDate ? new Date(currentStartDate) : null);
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [selectedIndex, filteredOptions]);

  return (
    <ModalContainerCustom
      id="start-date-picker"
      isOpen={true}
      toggle={() =>
        closeHandler(currentStartDate ? new Date(currentStartDate) : null)
      }
      keyboard={false}
      shouldCloseOnClickOutside={true}
      backdrop="static"
      className="paletteModalSizing xs:max-h-full sm:min-w-[560px] sm:top-[24%] sm:max-h-[520px]"
    >
      <ModalHeaderComp header="Start date" />
      <ModalBody className="p-0 rounded-b-[4px]">
        <ModalInput
          id="filter-input"
          value={keyword}
          placeholder="e.g. today, next week monday …"
          onChange={handleInputChange}
        />
        <ModalListContainer
          className="max-h-[364px]"
          handleMouseMove={handleMouseMove}
          id="filteredCommandsList"
        >
          {filteredOptions?.map((option, index) => (
            <ModalRowElementContainer
              key={index}
              onMouseEnter={() => handleMouseEnter(index)}
              handleMouseLeave={handleMouseLeave}
              onClick={enterHandler}
              id={`start-date-option-${index}`}
              index={index}
              commandRef={elRef}
              isSelected={selectedIndex === index}
            >
              <span>{option?.display}</span>
              {option?.date && (
                <span>{formatDateDifference(option?.date, true)}</span>
              )}
            </ModalRowElementContainer>
          ))}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default StartDateModal;
