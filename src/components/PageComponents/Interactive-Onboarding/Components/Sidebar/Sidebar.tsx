"use client";
import React, { ReactNode } from "react";
import { ChevronRight, Plus } from "lucide-react";

import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { IBoardHeader } from "@/models/InteractiveOnboarding/model";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import { getStyle } from "@/lib/constants/InteractiveOnboarding/constants";

type Props = {
  children: ReactNode;
};

const SidebarContainer = ({ children }: Props) => {
  const {
    activeScene,
    filteredSideBarOptions,
    sideBarInput,
    handleSideBarInput,
    activeModalIndex,
    currentUser,
  } = useTutorialContext();
  const isApple = useDeviceContext();
  return (
    <>
      {activeScene.index === 20 && (
        <div
          style={{ outline: "none", zIndex: "300" }}
          className="fixed h-SVH-full w-screen bg-black bg-opacity-25"
        >
          <div className="fixed shadow-customshadow-2  flex flex-col justify-between bg-sidebar sm:max-w-[461px] w-[80vw]  h-SVH-full top-0 left-0 text-white-black pt-[env(safe-area-inset-top)]">
            {/* ================== current user ================ */}
            <div style={{ display: "flex", padding: "20px 16px" }}>
              <div
                className="text-white-black"
                style={{ display: "flex", width: "100%", alignItems: "center" }}
              >
                <img
                  src={currentUser?.photoURL}
                  className="rounded-full w-8"
                  alt="profile"
                />

                <div
                  style={{
                    flex: 1,
                    fontSize: "14px",
                    fontWeight: "500",
                    padding: "0px 16px",
                  }}
                >
                  {currentUser?.email}
                </div>
                <ChevronRight size={25}  strokeWidth={1.75}/>
              </div>
            </div>

            {/* ===================== favorites and teams ============ */}
            <div
              style={{
                flex: 1,
                flexDirection: "column",
                width: "100%",
                alignItems: "flex-start",
                margin: "2px 0px",
              }}
            >
              <>
                <input
                  className="text-subheading sm:text-heading bg-transparent outline-none font-medium px-[16px] py-2 mb-3 "
                  id="boardManager"
                  autoFocus
                  placeholder="Search"
                  autoComplete="off"
                  style={{ backgroundColor: "transparent", outline: "none" }}
                  onChange={handleSideBarInput}
                  value={sideBarInput}
                />

                <div className="flex flex-col gap-6 favsAndTeamsContainer">
                  <>
                    <div>
                      {/* ========================= TEAM TITLE ====================== */}
                      <div className="flex text-content items-center gap-2">
                        <span className="pl-[16px]  font-semibold">
                          { currentUser.id===0?'Your team': `${currentUser.displayName}'s Team`}
                        </span>
                        <Plus className="text-meta mb-[2px]  text-text-muted"  strokeWidth={1.75}/>
                      </div>

                      {/* ========================= TEAM allProjects ====================== */}
                      <div className="mt-2 ">
                        {filteredSideBarOptions.map(
                          (item: IBoardHeader, index: number) => (
                            <div
                              key={`sthsth-sidebar${index}`}
                              id={`projecalsdkt-${index}`}
                              className={` px-[16px] py-2 flex gap-1 items-center ${
                                activeModalIndex === index
                                  ? "bg-active-modal-element"
                                  : "transparent"
                              }`}
                            >
                              <>
                                {/* --------------------- PROJECT TITLE ------------------ */}

                                <span className="text-content mr-4 font-normal text-white-black">
                                  {item.title}
                                </span>

                                <>
                                  <div>
                                    <img
                                      src={item.ownerImg}
                                      alt="owner-img"
                                      className="object-cover"
                                      style={getStyle(item.ownerImg, 16)}
                                    />
                                  </div>
                                  {item.memberImgs.length > 0 &&
                                    item.memberImgs.map((url, index) => (
                                      <div
                                        key={`memberimgs-${index}`}
                                        style={{ marginLeft: "-8px" }}
                                      >
                                        <img
                                          style={getStyle(url, 16)}
                                          src={url}
                                          alt="member-img"
                                          className="object-cover"
                                        />
                                      </div>
                                    ))}
                                </>
                              </>
                              <div className="flex-grow justify-end mr-4 flex gap-1  text-meta font-bold text-white-black">
                                <kbd
                                  className={` py-[1px] mx-[1.5px] h-fit rounded-[2px]  border-gray-200 bg-[#555B64] dark:border-gray-500`}
                                >
                                  {isApple ? "CMD" : "CTRL"}
                                </kbd>
                                <kbd
                                  className={`px-1 py-[1px] mx-[1.5px] h-fit rounded-[2px]  border-gray-200 bg-[#555B64]  dark:border-gray-500`}
                                >
                                  {index + 1}
                                </kbd>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </>
                </div>
              </>
            </div>
          </div>
        </div>
      )}
      {children}
    </>
  );
};

export default SidebarContainer;
