/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */
"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRecoilState } from "@/lib/state";
import { showCommandsAtom } from "@/store";
import { IUser } from "@/models/model";
import dynamic from "next/dynamic";
const PinnedCommentsContainer = dynamic(
  () => import("@/components/PageComponents/Pinned/PinnedCommentComp")
);
import { useSearchParams } from "next/navigation";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useGetPinnedContent } from "@/hooks/General/useGetPinnedContent";
const HypertasksCommands = dynamic(() => import("@/components/commands"), {
  ssr: false,
});

const tabs = [
  {
    prev: null,
    curr: "Your Pins",
    next: "Team Pins",
  },
  {
    prev: "Your Pins",
    curr: "Team Pins",
    next: "Your Pins",
  },
];

interface IProp {
  _savedContent: string;
  currentUser: IUser;
}

const Pinned = (props: IProp) => {
  const { _savedContent, currentUser } = props;
  const searchParams = useSearchParams();
  const { data: savedContentFromTQ } = useGetPinnedContent(
    currentUser.id,
    JSON.parse(_savedContent)
  );

  const { toggleShowCommands } = useHypertasksRecoilStates();
  const [showCommands, _] = useRecoilState(showCommandsAtom);
  const [selectedScreen, setSelectedScreen] = useState(
    searchParams?.get("yourPins") ? tabs[1] : tabs[0]
  );

  const router = useRouter();
  const isApple = useDeviceContext();

  const handleKeyDown = async (e: KeyboardEvent) => {
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);

    if (e.key === "Escape") router.back();

    // press k
    if (e.keyCode === 75 && cmdControl) {
      e.preventDefault();
      // console.log("1: change commands mode");
      toggleShowCommands();
    }

    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      setSelectedScreen(
        selectedScreen.curr === "Your Pins" ? tabs[1] : tabs[0]
      );
      // else if (selectedScreen.prev) setSelectedScreen(tabs[0])
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      setSelectedScreen(tabs[0]);
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedScreen]);

  return (
    <>
      <div className="flex items-center justify-center flex-col w-full min-h-screen bg-pageBackground scrollbar-w-[0] ">
        <div
          className={`global-view-width min-h-screen py-9 px-16 flex flex-col items-start space-y-4 bg-containerBackground`}
        >
          <div
            className={` flex gap-5 px-6 text-content`}
          >
            {tabs.map((tab) => (
              <>
                <span
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
                  <p className="font-normal text-micro">
                    {tab.curr === "Your Pins"
                      ? savedContentFromTQ.personalPins?.length
                      : savedContentFromTQ.teamPins?.length}
                  </p>
                </span>
              </>
            ))}
          </div>

          {selectedScreen.curr === "Your Pins" ? (
            <PinnedCommentsContainer
              _savedContent={savedContentFromTQ.personalPins}
              _currentUser={currentUser}
              _pinType="Personal"
            />
          ) : (
            <PinnedCommentsContainer
              _savedContent={savedContentFromTQ.teamPins}
              _currentUser={currentUser}
              _pinType="Team"
            />
          )}
        </div>
      </div>

      <div
        onClick={() => router.back()}
        className="bg-back-button"
        style={{
          cursor: "pointer",
          position: "fixed",
          zIndex: 100,
          top: 40,
          left: 40,
          width: 40,
          height: 40,
          borderRadius: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center" }}
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

      {showCommands.show && <HypertasksCommands />}
    </>
  );
};

export default Pinned;
