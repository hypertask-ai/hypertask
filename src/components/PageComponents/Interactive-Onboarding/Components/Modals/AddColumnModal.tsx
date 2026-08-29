import {
  ModalHeaderComp,
  ModalInput,
} from "@/components/Common/CommonModalComponents";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import React from "react";
import TutorialTooltip from "../TutorialTip";

const AddColumnModal = () => {
  const { handleAddColumnInput, addColumnInput } = useTutorialContext();
  return (
    <div
      id="htc-container"
      className="flex items-center justify-center fixed top-[180px] bg-transparent right-0 left-0 z-[9999] text-white-black"
    >
      <div
        className="rounded-[4px] customshadow-4"
        style={{ background: "#333B47" }}
      >
        <div
          className="p-0 shadow-customshadow-2 rounded-[4px]  w-[680px] max-h-[400px] bg-modalBackground "
        >
          <ModalHeaderComp header="Add Column" className="px-[20px]" />
          <div className="bg-[#E5663] p-0 rounded-[4px] w-[680px] relative group">
            <ModalInput
              onChange={handleAddColumnInput}
              value={addColumnInput}
              placeholder="Column name"
            />
            <TutorialTooltip text="Type 'Done'" top={15} left={-95} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddColumnModal;
