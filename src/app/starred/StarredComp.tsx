/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */
"use client";
import { useRouter } from "next/navigation";
import { useContext, useEffect, useState } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { appShellRailAtom, showCommandsAtom } from "@/store";
import { IUser } from "@/models/model";
import dynamic from "next/dynamic";
const StarredRow = dynamic(
  () => import("@/components/PageComponents/Starred/StarredRowComp")
);
import { useSearchParams } from "next/navigation";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useGetStarredContent } from "@/hooks/General/useGetStarredContent";
const HypertasksCommands = dynamic(() => import("@/components/commands"), {
  ssr: false,
});
import Goback from "@/assets/gobackicon.svg";
import Image from "next/image";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { APP_SHELL_RAIL_OFFSET } from "@/lib/constants/appShellRail";

const tabs = [
  {
    prev: null,
    curr: "Starred Tasks",
    next: "Starred Comments",
  },
  {
    prev: "Starred Tasks",
    curr: "Starred Comments",
    next: "Starred Tasks",
  },
];

interface IProp {
  _savedContent: string;
  currentUser: IUser;
}

const Starred = (props: IProp) => {
  const { _savedContent, currentUser } = props;
  const searchParams = useSearchParams();
  const { data: savedContentFromTQ } = useGetStarredContent(
    currentUser.id
    // JSON.parse(_savedContent)
  );

  const { toggleShowCommands } = useHypertasksRecoilStates();
  const [showCommands, _] = useRecoilState(showCommandsAtom);
  const [selectedScreen, setSelectedScreen] = useState(
    searchParams?.get("starredTasks") ? tabs[1] : tabs[0]
  );

  const router = useRouter();
  const isApple = useDeviceContext();
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;

  const handleKeyDown = async (e: KeyboardEvent) => {
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);

    if (e.keyCode === KeyCodes.ESCAPE) router.back();

    // press k
    if (e.keyCode === KeyCodes.K && cmdControl) {
      e.preventDefault();
      toggleShowCommands();
    }

    if (e.keyCode === KeyCodes.TAB && !e.shiftKey) {
      e.preventDefault();
      setSelectedScreen(
        selectedScreen.curr === "Starred Tasks" ? tabs[1] : tabs[0]
      );
    } else if (e.keyCode === KeyCodes.TAB && e.shiftKey) {
      e.preventDefault();
      setSelectedScreen(tabs[0]);
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedScreen]);

  const content = (
      <div className="flex items-center justify-center flex-col w-full min-h-screen bg-pageBackground scrollbar-w-[0]">
        <div
          className="global-view-width relative flex min-h-screen flex-col items-start bg-containerBackground pb-20 md:space-y-4 md:px-16 md:py-9 md:pb-0"
        >
          <div
            className={`flex gap-5 px-6 items-center fixed md:static bottom-0 right-0 left-0 
        bg-hoverCardBackground md:bg-transparent h-20 md:h-auto 
        text-emphasis md:text-subheading z-10 md:z-auto border-t md:border-t-0 border-gray-800`}
          >
            {tabs.map((tab) => (
              <span
                key={tab.curr}
                className={`flex gap-1 items-baseline
            ${
              selectedScreen.curr === tab.curr
                ? "font-bold text-white-black"
                : "text-text-light-gray"
            } cursor-pointer`}
              >
                <p onClick={() => setSelectedScreen(tab)} className={``}>
                  {tab.curr}
                </p>
                <p className="font-normal text-meta md:text-emphasis">
                  {tab.curr === "Starred Tasks"
                    ? savedContentFromTQ.starredTasks?.length
                    : savedContentFromTQ.pinnedComments?.length}
                </p>
              </span>
            ))}
          </div>

          {selectedScreen.curr === "Starred Tasks" ? (
            <StarredRow
              _savedContent={savedContentFromTQ.starredTasks}
              _currentUser={currentUser}
              _starType="Task"
            />
          ) : (
            <StarredRow
              _savedContent={savedContentFromTQ.pinnedComments}
              _currentUser={currentUser}
              _starType="Comment"
            />
          )}
        </div>
      </div>
  );

  return (
    <>
      {appShellRailOn && <AppShellRail variant="global" currentUser={currentUser} />}
      {appShellRailOn ? <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div> : content}
      <div
        onClick={() => router.back()}
        className="bg-back-button hidden md:flex fixed z-[100] top-10 w-10 h-10 rounded-full items-center justify-center cursor-pointer"
        style={{ left: appShellRailOn ? APP_SHELL_RAIL_OFFSET : 40 }}
      >
        <svg
          stroke="currentColor"
          className="text-white-black"
          fill="currentColor"
          strokeWidth="0"
          viewBox="0 0 448 512"
          color="white"
          height="1em"
          width="1em"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M257.5 445.1l-22.2 22.2c-9.4 9.4-24.6 9.4-33.9 0L7 273c-9.4-9.4-9.4-24.6 0-33.9L201.4 44.7c9.4-9.4 24.6-9.4 33.9 0l22.2 22.2c9.5 9.5 9.3 25-.4 34.3L136.6 216H424c13.3 0 24 10.7 24 24v32c0 13.3-10.7 24-24 24H136.6l120.5 114.8c9.8 9.3 10 24.8.4 34.3z"></path>
        </svg>
      </div>
      <div
        onClick={() => router.back()}
        className="fixed z-[101] bottom-[110px] right-4 rounded-[20px] justify-center md:hidden cursor-pointer shadow-customshadow-2 flex w-fit px-3 py-[2px] h-fit gap-2 items-center bg-modalBackground text-[#8E9093]"
      >
        {/* <FaArrowLeft color='#FFFFFF' /> */}
        <Image src={Goback} alt="icon" width={28} height={28} />
        <span>Back</span>
      </div>

      {showCommands.show && <HypertasksCommands />}
    </>
  );
};

export default Starred;
