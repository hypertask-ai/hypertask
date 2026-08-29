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

// HTPR-4885/4886: the house filterable-list submodal, extracted so recurrence
// presets and task templates share one keyboard-driven picker instead of each
// re-implementing the CreateLabel/MoveTaskToBoard pattern.

export interface PickerOption {
  id: string | number | null;
  label: string;
  hint?: string;
}

interface Props {
  header: string;
  placeholder?: string;
  options: PickerOption[];
  emptyMessage?: string;
  onSelect: (option: PickerOption) => void;
  onClose: () => void;
}

const OptionPickerModal: React.FC<Props> = ({
  header,
  placeholder = "Type to filter…",
  options,
  emptyMessage = "Nothing here yet",
  onSelect,
  onClose,
}) => {
  const [keyword, setKeyword] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } =
    useHandleMouseGlobal({ setSelectedIndex });

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(query)
    );
  }, [keyword, options]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setKeyword(event.target.value);
    setSelectedIndex(0);
  };

  const selectAt = (index: number) => {
    const option = filtered[index];
    if (!option) return;
    setTimeout(() => onSelect(option), 1);
  };

  const move = (delta: number) => {
    if (filtered.length === 0) return;
    const next = selectedIndex + delta;
    if (next < 0 || next > filtered.length - 1) return;
    setSelectedIndex(next);
    document
      .getElementById(`option-picker-${next}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectAt(selectedIndex);
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [selectedIndex, filtered]);

  return (
    <ModalContainerCustom
      id="option-picker"
      isOpen={true}
      toggle={onClose}
      keyboard={false}
      shouldCloseOnClickOutside={true}
      backdrop="static"
      className="paletteModalSizing xs:max-h-full sm:min-w-[560px] sm:top-[24%] sm:max-h-[520px]"
    >
      <ModalHeaderComp header={header} />
      <ModalBody className="p-0 rounded-b-[4px]">
        <ModalInput
          id="filter-input"
          value={keyword}
          placeholder={placeholder}
          onChange={handleInputChange}
        />
        <ModalListContainer
          className="max-h-[364px]"
          handleMouseMove={handleMouseMove}
          id="filteredCommandsList"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-content text-text-light-gray">
              {emptyMessage}
            </div>
          ) : (
            filtered.map((option, index) => (
              <ModalRowElementContainer
                key={`${option.id ?? "none"}-${index}`}
                onMouseEnter={() => handleMouseEnter(index)}
                handleMouseLeave={handleMouseLeave}
                onClick={selectAt}
                id={`option-picker-${index}`}
                index={index}
                commandRef={elRef}
                isSelected={selectedIndex === index}
              >
                <span>{option.label}</span>
                {option.hint && <span>{option.hint}</span>}
              </ModalRowElementContainer>
            ))
          )}
        </ModalListContainer>
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default OptionPickerModal;
