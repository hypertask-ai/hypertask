import { Pencil, X } from "lucide-react";
import AIModelDropDownButton from "@/components/Global/ModelSelectorDropdown";

import { TAiModal, TAiMode } from "@/models/AI_Task_writer_model";
import ResponseNavigator from "./ResponseNavigator";
import { useAITaskWriterContext } from "@/lib/contexts/TaskDetail/AITaskWriterContext";
import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";

const AITaskWriterHeadline = ({
  onCloseHandler,
  currentOptions,
  dropdownCallback,
  selectedAi,
  defaultMode,
  aiResponse = "",
  handleAccept,
}: {
  onCloseHandler: any;
  currentOptions: TAiModal[];
  dropdownCallback: (item: TAiModal) => void;
  selectedAi: TAiModal;
  defaultMode: TAiMode;
  aiResponse?: string;
  handleAccept: () => void;
}) => {
  const {
    currentResponseIndex,
    responseHistory,
    navigateResponse,
    modelTeamId,
    modelBilling,
  } = useAITaskWriterContext();

  return (
    <span 
      style={{fontSize:aiTaskWriterConfig.fontSizes.layout}}
      className="flex py-1 font-medium text-white-black items-center justify-between">
      <div className="items-center flex gap-2">
        <Pencil size={18}
          className={" text-hypertasks-ai-purple cursor-pointer"}
         strokeWidth={1.75}/>
        <span>
          {defaultMode === "WriteWithAI" ? "Write With AI" : "AI Task Writer"}
        </span>
        <ResponseNavigator
          currentIndex={currentResponseIndex}
          totalResponses={responseHistory.length}
          onNavigate={navigateResponse}
          onAccept={handleAccept}
        />
      </div>


      <div className="items-center flex gap-2">
        <AIModelDropDownButton
          optionCallback={dropdownCallback}
          aiSelected={selectedAi}
          currentOptions={currentOptions}
          modelTeamId={modelTeamId}
          modelBilling={modelBilling}
        />
      <X size={18}
          style={{fontSize:aiTaskWriterConfig.fontSizes.moderateIcon}}
          className="cursor-pointer " onClick={onCloseHandler}  strokeWidth={1.75}/>
      </div>
    </span>
  );
};


export default AITaskWriterHeadline;
