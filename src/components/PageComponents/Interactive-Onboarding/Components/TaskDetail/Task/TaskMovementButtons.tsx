import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import React from "react";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";


const TaskMovementContainer = () => {
  const { activeTaskPage } = useTutorialContext();
  return (
    <div
      className="fixed  flex gap-2  items-center  flex-col xl:flex-row xl:left-10 left-5"
      style={{
        zIndex: 9991,
        top: 40,
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
        }}
        className="cursor-pointer justify-center items-center flex group bg-back-button shadow-md border-light-black-border-4"
      >
        <ArrowLeft className="text-button-arrow"  strokeWidth={1.75}/>
      </div>
      {/**------------------------------- Task Movement */}
      <>
        {/* ======================= arrow container ======================== */}
        <div className="flex rounded-[20px] py-[6px] mx-1 items-center justify-center bg-back-button shadow-md flex-col xl:flex-row">
          {/* ======================= arrow up ================ */}
          <span className="w-10 h-[28px] grid place-items-center relative group border-white cursor-pointer">
            <ChevronUp
              className={`mx-auto ${
                true ? "text-button-arrow-disabled" : "text-button-arrow"
              } `}
              // color={`${indexOf===0 || tasksPlayList?.length===0 ?"gray":"white"}`}
             strokeWidth={1.75}/>
          </span>

          {/* ======================= arrow down ================ */}
          <span
            className={`w-10 h-[28px] grid place-items-center relative group cursor-pointer
              
              `}
          >
            <ChevronDown
              className={`${
                false ? "text-button-arrow-disabled" : "text-button-arrow"
              }`}
              color={``}
             strokeWidth={1.75}/>
          </span>
        </div>

        <span className="text-meta text-white-black">
          {activeTaskPage===0 && '2 / 6'}
          {activeTaskPage===1 && '1 / 2'}
          {activeTaskPage===2 && '2 / 2'}
        </span>
      </>
    </div>
  );
};

export default TaskMovementContainer;
