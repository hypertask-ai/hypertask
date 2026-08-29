import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import { ReactNode } from "react";

const DescriptionContainer = ({ children }: { children: ReactNode }) => {
  const { activeScene } = useTutorialContext();
  //add 7 to the include array.
  return (
    <div
    id="description-input-interactive"
      className={`group/descriptionContainer description-container text-emphasis pt-[20px]
        pb-1 mb-[8px] px-[16px] shadow-md rounded-[4px] w-full bg-comment-description outline-none
        ${
          activeScene.index >= 30 //if the active scene is here
            ? `shadow-2xl ${
                [30, 31].includes(activeScene.index)
                  ? // if the activescene is here then and only then
                    `border-l-[#C2CFA5]`
                  : "border-l-selected-item-border"
              }`
            : "border-l-transparent"
        }`}
      style={{ borderLeftWidth: 4 }}
    >
      {children}
    </div>
  );
};

export default DescriptionContainer;
