"use client";
import React, { ReactNode } from "react";
import { IHintText, ISubText } from "@/models/InteractiveOnboarding/model";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import styles from "@/styles/shake.module.scss";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { cn } from "@/utils/undoActions/helperFuncs";

type Props = {
  children: ReactNode;
};

const Wrapper = ({ children, sceneIndex }: { children: ReactNode; sceneIndex: number }) => {
  return (
    <div className={cn("relative", sceneIndex === 18 && "text-white")}>
      <div
        style={{
          zIndex: 5001 }}
        className={cn(

          "bg-containerBackground fixed bottom-0 border-t-[1px] border-opacity-20 border-t-black w-full py-2.5 min-h-[131px]"
        )}
      >
        {children}
      </div>
    </div>
  );
};

const FooterContainer = ({ children }: Props) => {
  const {
    currentScene,
    shake,
    activeHint,
    exitTutorial,
    activeScene,
    showExit,
  } = useTutorialContext();

  const isApple = useDeviceContext();

  return activeScene.index > 32 ? (
    <>{children}</>
  ) : (
    <>
      {children}
      <Wrapper sceneIndex={activeScene.index}>
        {showExit && <ExitOption exitTutorial={exitTutorial} isApple={isApple} />}

        <div className="flex flex-col items-center">
          <span
            className={`d-none d-sm-block mb-3 text-content ml-[5px] md:text-subheading md:ml-[8px] ${activeScene.index === 18 ? "text-white" : "text-white-black"}`}
            
          >
            {currentScene.title}
          </span>
          <p className="inline-flex">
            <SubTitleText subText={currentScene.subtitle} sceneIndex={activeScene.index} />
          </p>

          <HintText
            sceneIndex={activeScene.index}
            hintText={currentScene.hint}
            shake={shake}
            currentHint={activeHint}
          />
        </div>
      </Wrapper>
    </>
  );
};

const ExitOption = ({
  exitTutorial,
  isApple,
  className,
}: {
  exitTutorial: () => void;
  isApple: boolean;
  className?: string;
}) => {
  return (
    <div
      id="exit-button-interactive"
      tabIndex={1}
      className={cn(
        `bg-active-modal-element px-3 py-1 md:py-2 md:px-4 shadow-customshadow-1 cursor-pointer
        rounded border-thin border-border-light-gray-thin flex items-center gap-2 w-fit
        text-white-black/70 text-content`,
        className
      )}
      onClick={() => exitTutorial()}
      style={{
        position: "absolute",
        bottom: "10px",
        left: "10px" }}
    >
      <span className="text-white-black">Exit Tutorial</span>
      <kbd
        className={`px-2 pt-[3px] rounded-[2px] border-gray-200 
            bg-[#555B64]  dark:border-gray-700 dark:border-[1px] text-micro`}
      >
        {isApple ? "CMD" : "CTRL"}
      </kbd>
      <kbd
        className={`px-2 pt-[3px] rounded-[2px] border-gray-200 
            bg-[#555B64]  dark:border-gray-700 dark:border-[1px] text-micro`}
      >
        .
      </kbd>
    </div>
  );
};

const SubTitleText = ({ subText, sceneIndex }: { subText: ISubText[]; sceneIndex: number }) => {
  return (
    <span
      className={`text-meta md:text-content ${sceneIndex === 18 ? "text-white" : "text-white-black"}`}
      style={{
        whiteSpace: "pre-line",
        textAlign: "initial",
        wordBreak: "break-all" }}
    >
      {subText.map((item, index) => (
        <React.Fragment key={`span-sub-${index}`}>
          {item.type === "key" ? (
            <span className={`p-1 ${sceneIndex === 18 ? "bg-white text-black" : "bg-black text-white"}`}>{item.content}</span>
          ) : (
            <>{item.content}</>
          )}{" "}
          &nbsp;
        </React.Fragment>
      ))}
    </span>
  );
};

const HintText = ({
  hintText,
  shake,
  currentHint,
  sceneIndex,
}: {
  hintText: IHintText[];
  shake: boolean;
  currentHint: number;
  sceneIndex: number;
}) => {
  const isFirstScene = sceneIndex === 0;

  return (
    <div className="my-1">
      <span
        className={cn(
          "d-none d-sm-block text-meta mx-[6px] my-[3px] md:mx-[10px] md:my-[7px]",
          sceneIndex === 18 ? "text-white" : "text-white-black"
        )}
        
      >
        {hintText.map((item, index) => (
          <React.Fragment key={`hint-${index}`}>
            {item.type === "key" ? (
              <div
                className={cn(
                  "inline-flex rounded-md",
                  isFirstScene && "",
                  item.index !== undefined && item.index === currentHint && shake
                    ? styles.shake
                    : ""
                )}
              >
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded",
                    isFirstScene
                      ? item.active
                        ? "bg-black text-white border-black"
                        : "bg-white text-black !border-thin border-gray-400"
                      : item.active
                      ? "px-2 py-2 border-[1px] bg-black text-white border-black"
                      : "px-2 py-2 border-[1px] bg-white text-black border-gray-400"
                  )}
                >
                  {isFirstScene ? "Enter" : item.content}
                </span>
              </div>
            ) : (
              <>{item.content}</>
            )}
            &nbsp;
          </React.Fragment>
        ))}
      </span>
    </div>
  );
};

export default FooterContainer;
