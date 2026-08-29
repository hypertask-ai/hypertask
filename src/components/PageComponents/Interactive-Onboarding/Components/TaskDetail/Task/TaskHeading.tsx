import { ArchiveNotificationIcon } from "@/lib/IconsLocal";
import React from "react";
import { Clock, Check, ChevronDown } from "lucide-react";


import BaseTitleContainer from "@/components/PageComponents/TaskDetail/TopRow/BaseTitleContainer";

const TaskHeadingContainer = ({ heading }: { heading: string }) => {
  return (
    <BaseTitleContainer
      dataAttribute="onboarding"
      zIndex={2000}
      useHorizontalPadding={false}
      containerClassName="pb-[16px]"
      titleRowClassName="xs:px-[18px] xs:pb-3"
      hasSummary={false}
      titleRowContent={
        <>
        <div
          className="flex items-center gap-2 "
          tabIndex={0}
          id="title"
          style={{ flex: 1 }}
        >
          <>
            {/* --------------------------- TITLE -------------------------- */}
            <div
              className="block items-center gap-[12px]"
              style={{
                whiteSpace: "pre-line",
                // wordBreak:"break-wr"
              }}
            >
              <span className="inline xs:text-subheading sm:text-heading sm:leading-[39px]">
                {heading}
              </span>
            </div>
          </>
        </div>

        <div
          className="flex items-center gap-[10px]"
        >
          <>
            {/**---------------------------------ARCHIVE TASK NOTIFICATION */}
            <>
              <div>
                <button className={` hidden relative group sm:block`}>
                  <ArchiveNotificationIcon height={18} width={18} show={true} />
                </button>
              </div>
            </>
            {/**----------------------------------REMIND ME TASK DETAIL */}
            <>
              <button className="relative group flex gap-1 items-center">
                <Clock className={`h-[18px] w-[18px] text-[${"#696b6e"}]`}  strokeWidth={1.75}/>
              </button>
            </>
          </>

          {/**--------------------------------------MARK TASK AS DONE */}
          <div tabIndex={0} id="markAsDone" className="relative group h-[20px]">
            <button tabIndex={-1}>
              <Check
                color={"#696b6e"}
                className={`transition-colors stroke-[4px] dark:stroke-[2px] duration-75 text-[#696b6e] hover:text-[#008000]`}
                size={20}
               strokeWidth={1.75}/>
            </button>
          </div>
        </div>
        </>
      }
    >
      {/**---------------------------------------TASK SUMMARY */}
      {false && (
        <div
          id="task-summary-container"
          className={`task-summary bg-taskDetal-container w-full`}
        >
          <div className="header group relative sm:px-[8px] text-text-light-gray pb-2">
            {!open ? (
              <div className="flex gap-1 justify-start items-center group">
                <span
                  className={`relative  ${
                    false ? "" : "scale-0 group-hover:scale-100"
                  }  `}
                >
                  <ChevronDown
                    className={`text-content ${false ? "rotate-180" : ""}`}
                   strokeWidth={1.75}/>
                </span>
              </div>
            ) : (
              <div className="flex gap-1 justify-start items-center">
                <span className="font-medium text-dense">Summary</span>
                <span
                  className={`relative  ${
                    false ? "" : "scale-0 group-hover:scale-100"
                  }  `}
                >
                  <ChevronDown
                    className={`text-content ${false ? "rotate-180" : ""}`}
                   strokeWidth={1.75}/>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </BaseTitleContainer>
  );
};

export default TaskHeadingContainer;
