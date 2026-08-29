import { useContext, useEffect, useState } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { appShellRailAtom, showShortcutsAtom } from "@/store";
import BackDropContainer from "./BackDropContainer";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import {
  DIV_ID_CONSTANTS,
  INPUT_ID_CONSTANTS,
} from "@/lib/configs/general.config";
import { getKeyboardShortcuts } from "@/lib/constants/shortcuts";
import { MobileViewContext } from "@/lib/contexts/mobileContext";

const KeyboardShortcuts = () => {
  const isApple = useDeviceContext();
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const [_showShortcuts, setShowShortcuts] = useRecoilState(showShortcutsAtom);
  const [keyword, setKeyword] = useState("");
  const mainData = getKeyboardShortcuts(isApple, appShellRailOn);
  const [filteredShortcuts, setFilteredShortcuts] = useState(mainData);

  // ====================== ON INPUT KEY CHANGE
  const onKeyChange = (e: any) => {
    setKeyword(e.target.value);
    filterData(e.target.value);
  };

  // ======================== keydown handler
  const keyPressHandler = (e: any) => {
    const isInputFocused = [
      "input",
      "textarea",
      "textbox",
      "ProseMirror",
    ].includes(document?.activeElement?.tagName?.toLowerCase() ?? "");

    if (e.keyCode === KeyCodes.ESCAPE || !isInputFocused) {
      e.preventDefault();
      setShowShortcuts(false);
    }
  };

  // =================== Function to filter based on search term
  const filterData = (searchTerm: string) => {
    const searchTermLower = searchTerm?.toLowerCase() || "";
    
    const filteredData: any = mainData
      .map((group) => {
        // Check if the group has a 'sub' property
        if (group.sub) {
          // Check if the section title matches the search term
          const sectionTitleMatches = group.title
            .toLowerCase()
            .includes(searchTermLower);

          // If section title matches, show all shortcuts in that section
          if (sectionTitleMatches) {
            return { ...group, sub: group.sub };
          }

          // Otherwise, filter shortcuts based on the search term in the 'shortTitle' property
          const filteredshortcuts_ = group.sub.filter((subItem: any) =>
            subItem.shortTitle
              .toLowerCase()
              .includes(searchTermLower)
          );

          // Check if there are shortcuts after filtering
          if (filteredshortcuts_.length > 0) {
            // Return the group with filtered shortcuts
            return { ...group, sub: filteredshortcuts_ };
          }

          // If no shortcuts after filtering, return null
          return null;
        }

        // If the group doesn't have 'sub', return as is
        return group;
      })
      .filter(Boolean); // Remove null values from the array

    // Set the filtered array in the state
    setFilteredShortcuts(filteredData);
  };

  function handleClick(event: any) {
    try {
      const container = document?.getElementById(
        DIV_ID_CONSTANTS.keyboardShortcuts
      );
      if (!container || !_showShortcuts) return;
      const isClickInside = container?.contains(event?.target);

      if (!isClickInside) {
        // The click was outside the container, perform your action here
        console.log("Clicked outside the container");
        // Optionally, hide the container
        setShowShortcuts(false);
      }
    } catch (error) {
      console.log("🚀 ~ document.addEventListener ~ error:", error);
    }
  }

  useEffect(() => {
    document.addEventListener("keydown", keyPressHandler);
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("keydown", keyPressHandler);
      document.removeEventListener("click", handleClick);
    };
  }, [keyPressHandler, keyword]);

  return (
    <BackDropContainer>
      <div
        id={DIV_ID_CONSTANTS.keyboardShortcuts}
        style={{ fontSize: 14 }}
        className="fixed bg-sidebar text-white-black top-0  right-0 w-[26vw] lg:w-min-[30vw] md:w-min-[32vw] overflow-y-auto h-SVH-full z-[100] pt-[env(safe-area-inset-top)]"
      >
        <input
          className="text-subheading w-full  sm:text-heading leading-[21.74px] bg-transparent outline-none font-medium px-4 pt-4 placeholder:text-[#8E9093]  "
          id={INPUT_ID_CONSTANTS.KeyboardShortcuts}
          autoFocus
          placeholder="Search"
          autoComplete="off"
          style={{ backgroundColor: "transparent", outline: "none" }}
          onChange={onKeyChange}
          value={keyword}
        />
        <div className="px-4">
          {filteredShortcuts?.map((section: any, sectionIndex: number) => (
            <div key={sectionIndex}>
              <h3 className="mt-10 mb-3 text-[#8E9093] text-content leading-[21px] font-medium">
                {section?.title}
              </h3>
              {section?.sub?.map((subItem: any, subIndex: number) => (
                <div
                  className="flex flex-row items-center mb-2 gap-2"
                  key={subIndex}
                >
                  <p className="w-[60%] font-normal text-content leading-[16.94px]">
                    {subItem.shortTitle}
                  </p>
                  <div className="flex gap-1 w-[40%]">
                    {subItem.pressKey.map((key: any, keyIndex: number) => (
                      <>
                        {!key ? (
                          <span className="px-[0.5px] font-bold">
                            then
                          </span>
                        ) : (
                          <kbd
                            className={`px-[6px] py-[4px] mx-[1.5px] rounded-[2px]
                            bg-[#4F5765] min-h-[25px] font-normal text-meta leading-[18px] text-white`}
                          >
                            {key}
                          </kbd>
                        )}
                      </>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </BackDropContainer>
  );
};

export default KeyboardShortcuts;
