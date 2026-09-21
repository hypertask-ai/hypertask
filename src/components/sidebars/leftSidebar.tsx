import React, {
  ChangeEvent,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  SetterOrUpdater,
  useRecoilState,
  useRecoilValue,
  useSetRecoilState,
} from "@/lib/state";
import {
  activeItemAtom,
  currentProjectAtom,
  CurrentGroupAtom,
  showBoardManagerAtom,
  showCommandsAtom,
  currentUserAtom,
  boardSortModeAtom,
  lastUsedBoardsAtom,
  isFavoritesExpandedAtom,
  showAccountSwitcherAtom,
} from "@/store";
import { IFavorites, IProject, IUser } from "@/models/model";
import {
  favoritesQueryKey,
  useGetAllFavorites,
} from "@/hooks/MultiPages/useGetAllFavorites";
import {
  scrollToCenterIfNearBottom,
  scrollToCenterIfNearTop,
} from "@/utils/helperFunctions/helperFunctions";
import "@/styles/leftSidebarStyle.scss";
import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";
import { orderTeamsForSwitcher } from "@/lib/teamSwitcherOrder";
import BackDropContainer from "./BackDropContainer";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { CommandMode } from "@/models/enums";
import { ChevronRight, Plus, Settings } from "lucide-react";
import { FaRobot } from "react-icons/fa6";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { isFavoriteBoardShortcut } from "@/lib/constants/shortcuts";
import { markBoardSwitchIntent } from "@/lib/analytics/boardSwitchLatency";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useSettingsNavigation } from "@/components/Modals/Settings/settingsNavigation";
import { prefetchBoard } from "@/utils/api/Homepage";
import UserAvatar from "@/components/Common/UserAvatar";

// Favorites are 10 numbered slots: index 1-9, then 0 for the tenth (Ctrl on
// Apple, Alt elsewhere).
// Slot 0 therefore sorts LAST, and the Nth favorite (position, 0-based) lives in
// slot 1..9 then 0.
const favoriteSlotOrder = (index: number) => (index === 0 ? 10 : index);
const slotForPosition = (pos: number) => (pos >= 9 ? 0 : pos + 1);

interface ISidebarFavs {
  id?: string;
  googleAccountId?: string;
  title: string;
  indexes: number[];
  projects: IProject[];
  group: Tgroup;
}

export type Tgroup = "Favs" | "Teams";
function LeftSidebar({ toggleLeftSidebar }: { toggleLeftSidebar: () => void }) {
  const currentUser = useRecoilValue(currentUserAtom);
  const [currentProject, setCurrentProject] =
    useRecoilState(currentProjectAtom);
  const setActiveItem = useSetRecoilState(activeItemAtom);
  const [_showBoardManager, setShowBoardManager] =
    useRecoilState(showBoardManagerAtom);
  const [currentGroup, setCurrentGroup] =
    useRecoilState<Tgroup>(CurrentGroupAtom);
  const [boardSortMode, setBoardSortMode] = useRecoilState(boardSortModeAtom);
  const [lastUsedBoards, setLastUsedBoards] =
    useRecoilState(lastUsedBoardsAtom);
  const [isFavoritesExpanded, setIsFavoritesExpanded] =
    useRecoilState(isFavoritesExpandedAtom);

  const { data: allTeamsTQ } = useGetAllTeamsMinimal(currentUser.id);
  const { data: favoritesTQ } = useGetAllFavorites(currentUser.UserSettingId);
  const { goToProjectShortcut, hyperAI } = useProjectQuery();
  const queryClient = useQueryClient();

  // ================== favorites drag-and-drop
  const favPersistRef = useRef<Promise<unknown>>(Promise.resolve());
  // Persist a new favorites order/set. The client sends the desired order; the
  // server assigns slots (= Ctrl on Apple / Alt elsewhere) by position and derives the user
  // from the session, so no userSettingId is sent.
  const persistFavorites = (orderedProjects: IProject[]) => {
    const capped = orderedProjects.slice(0, 10);
    const optimistic = capped.map((project, pos) => ({
      id: `optimistic-${project.id}`,
      index: slotForPosition(pos),
      projectId: project.id,
      project,
    }));
    queryClient.setQueryData(
      favoritesQueryKey(currentUser.UserSettingId),
      optimistic,
    );
    // Serialize writes: each PUT replaces the whole set, so an out-of-order
    // resolve of two quick reorders would otherwise clobber the newer one.
    favPersistRef.current = favPersistRef.current
      .catch(() => {})
      .then(() =>
        axios.put("/api/favorites/reorderFavorites", {
          favorites: capped.map((project) => ({ projectId: project.id })),
        })
      )
      .finally(() =>
        queryClient.invalidateQueries({ queryKey: ["getAllFavorites"] })
      );
  };

  const onFavoritesDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    // Drag is disabled while searching, but guard anyway (filtered indexes
    // wouldn't map to the full favorites list).
    if (keyword) return;

    const src = source.droppableId;
    const dst = destination.droppableId;
    if (src !== "favorites" && dst !== "favorites") return; // board <-> board: ignore
    const projectId = Number(draggableId.replace(/^(fav|board)-/, ""));

    let favProjects: IProject[] = (favoritesTQ ?? [])
      .slice()
      .sort(
        (a: { index: number }, b: { index: number }) =>
          favoriteSlotOrder(a.index) - favoriteSlotOrder(b.index)
      )
      .map((f: { project: IProject }) => f.project);

    if (src === "favorites" && dst === "favorites") {
      if (source.index === destination.index) return;
      const [moved] = favProjects.splice(source.index, 1);
      favProjects.splice(destination.index, 0, moved);
    } else if (src !== "favorites" && dst === "favorites") {
      if (favProjects.some((p) => p.id === projectId)) return; // already favorited
      if (favProjects.length >= 10) return; // all 10 slots full
      const project = (allTeamsTQ ?? [])
        .flatMap((t: any) => t.projects as IProject[])
        .find((p: IProject) => p.id === projectId);
      if (!project) return;
      favProjects.splice(destination.index, 0, project);
    } else {
      // favorites -> board list: unfavorite
      favProjects = favProjects.filter((p) => p.id !== projectId);
    }

    persistFavorites(favProjects);
  };

  const [selectedProject, setSelectedProject] = useState<IProject | null>(null);

  const [favsAndTeams, setFavsAndTeams] = useState<any[]>([]);
  const [keyword, setKeyword] = useState("");

  const [filteredFavsandTeams, setFilteredFavsandTeams] = useState<any>([]);
  const [filterdFavorites, setFilterdFavorutes] =
    useState<ISidebarFavs | null>();
  const [filteredAllProjects, setFitleredAllProjects] = useState<IProject[]>(
    allTeamsTQ?.map((item: any) => item.projects).flat()
  );

  const sidebarRef = useRef<HTMLDivElement>(null);
  const mbl = useContext(MobileViewContext);
  const isApple = useDeviceContext();

  const keyDownHandler = (e: KeyboardEvent) => {
    if (!_showBoardManager) return;
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);

    if (e.keyCode === KeyCodes.ESCAPE) {
      setShowBoardManager(false);
    }
    // switch between different boards
    if (favoritesTQ) {
      if (
        e.keyCode >= KeyCodes.ZERO &&
        e.keyCode <= KeyCodes.NINE &&
        isFavoriteBoardShortcut(e, isApple)
      ) {
        e.preventDefault();
        handleBoardClick(e.keyCode - KeyCodes.ZERO);
      }
    }
    if (cmdControl && e.keyCode === KeyCodes.B) {
      e.preventDefault();
      setShowBoardManager(false);
    }
    if (e.keyCode === KeyCodes.ENTER && selectedProject) {
      e.preventDefault();

      markBoardSwitchIntent({ surface: "sidebar", projectId: selectedProject.id });
      goToProjectShortcut(selectedProject.id, true);
      setShowBoardManager(false);
      setActiveItem(null);
    }

    if (e.keyCode === KeyCodes.ARROW_DOWN) {
      e.preventDefault();

      if (!selectedProject) return;
      if (currentGroup === "Favs") {
        let index =
          filterdFavorites?.projects.findIndex(
            (item) => item.id === selectedProject.id
          ) ?? -1;
        if (index < 0 || !filterdFavorites?.projects) return;
        handleDownFavs(index);
      }
      // handle down for teams
      else {
        let index = filteredAllProjects.findIndex(
          (item) => item.id === selectedProject.id
        );
        handleDownTeams(index);
      }
    }

    if (e.keyCode === KeyCodes.ARROW_UP) {
      e.preventDefault();
      if (!selectedProject) return;
      if (currentGroup === "Favs") {
        let index =
          filterdFavorites?.projects.findIndex(
            (item) => item.id === selectedProject.id
          ) ?? -1;
        if (index < 0 || !filterdFavorites?.projects) return;

        handleUpFavs(index);
      }
      // handle down for teams
      else {
        let index =
          filteredAllProjects.findIndex(
            (item) => item.id === selectedProject.id
          ) ?? -1;
        if (index < 0) return;

        handleUpTeams(index);
      }
    }
  };

  // ============ helper for upward scrolling
  const scrollTopHandler = (id: number) => {
    let projectElement = document.getElementById(`project-${id}`);
    projectElement && scrollToCenterIfNearTop(projectElement);
  };

  // ============ helper for downward scrolling
  const scrollBottomHandler = (id: number) => {
    let projectElement = document.getElementById(`project-${id}`);
    projectElement && scrollToCenterIfNearBottom(projectElement, 30);
  };

  // ============== handle up in favs
  function handleUpFavs(index: number) {
    if (!filterdFavorites?.projects) return;
    if (index > 0) {
      let projectToSelect = filterdFavorites.projects[index - 1];
      scrollTopHandler(projectToSelect.id);
      setSelectedProject(filterdFavorites.projects[index - 1]);
    }
  }

  // ============== handle up in teams
  function handleUpTeams(index: number) {
    if (index === 0 && filterdFavorites && isFavoritesExpanded) {
      let projectToSelect =
        filterdFavorites.projects[filterdFavorites.projects.length - 1];
      document
        .getElementById(`project-${projectToSelect.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "end" });
      setSelectedProject(projectToSelect);
      setCurrentGroup("Favs");
    } else if (index > 0) {
      let projectToSelect = filteredAllProjects[index - 1];
      scrollTopHandler(projectToSelect.id);
      setSelectedProject(projectToSelect);
    }
    // If index === 0 and favorites are collapsed, do nothing (can't go up)
  }

  // ============== handle down in favs
  function handleDownFavs(index: number) {
    if (!filterdFavorites) return;
    if (index >= 0 && index === filterdFavorites.projects.length - 1) {
      setCurrentGroup("Teams");
      setSelectedProject(filteredAllProjects[0]);
    } else {
      setSelectedProject(filterdFavorites.projects[index + 1]);
    }
  }

  // ============== handle down in teams
  function handleDownTeams(index: number) {
    if (index >= 0 && index === filteredAllProjects.length - 1) {
    } else {
      let projectToSelect = filteredAllProjects[index + 1];
      scrollBottomHandler(projectToSelect.id);
      setSelectedProject(projectToSelect);
    }
  }

  // =============== handle onclick board
  const handleBoardClick = (key: number) => {
    const index = favoritesTQ?.findIndex(
      (favorite: IFavorites) => favorite.index === key
    );

    if (index >= 0 && favoritesTQ[index].projectId !== currentProject?.id) {
      const projectId = favoritesTQ[index].project.id;
      toggleLeftSidebar();
      markBoardSwitchIntent({ surface: "sidebar", projectId });
      goToProjectShortcut(projectId, true);
    }
  };

  function hanleMouseLeave() {
    setShowBoardManager(false);
    toggleLeftSidebar();
  }

  // =================== Function to filter based on search term
  const filterData = (searchTerm: string) => {
    const filteredData = favsAndTeams
      .map((group) => {
        // Check if the group has a 'projects' property
        if (group.projects) {
          // Filter projects based on the search term in the 'title' property
          console.log("🚀 ~ filteredData ~ filteredProjects:", group.projects);
          const filteredProjects = group.projects.filter(
            (project: { title: string }) =>
              project.title?.toLowerCase().includes(searchTerm?.toLowerCase())
          );

          // Check if there are projects after filtering
          if (filteredProjects.length > 0) {
            // Return the group with filtered projects
            return { ...group, projects: filteredProjects };
          }

          // If no projects after filtering, return null
          return null;
        }

        // If the group doesn't have 'projects', return as is
        return group;
      })
      .filter(Boolean); // Remove null values from the array

    // Set the filtered array in the state
    setFilteredFavsandTeams(filteredData);

    // Set selectedProject and currentGroup from filtered data
    if (filteredData.length > 0) {
      setSelectedProject(filteredData[0]?.projects[0]);
      setCurrentGroup(filteredData[0]?.group);

      // if the first group is filteredFavorites, set favorites and teams separately
      if (filteredData[0].group === "Favs") {
        setFilterdFavorutes(filteredData[0]);
        // reset all filtered projects (everything except the first group)
        setFitleredAllProjects(
          filteredData
            .slice(1)
            .map((item: { projects: IProject[] }) => item.projects)
            .flat() ?? []
        );
      } else {
        // if it's teams, set filtered favs as null and all projects as ALL
        setFilterdFavorutes(null);
        setFitleredAllProjects(
          filteredData
            .map((item: { projects: IProject[] }) => item.projects)
            .flat()
        );
      }
    } else {
      // Handle empty filtered data
      setFilterdFavorutes(null);
      setFitleredAllProjects([]);
    }
  };

  // ================== close when click outside
  const handleOutSideClick = (event: any) => {
    if (sidebarRef.current && !sidebarRef.current?.contains(event.target)) {
      setShowBoardManager(false);
    } else {
    }
  };

  // ====================== ON INPUT KEY CHANGE
  const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    setKeyword(e.target.value);
    filterData(e.target.value);
  };

  function onCacheUpdate() {
    // Slot 0 is the tenth favorite (Ctrl+0 on Apple / Alt+0 elsewhere), so it sorts last.
    const sortedFavorites =
      favoritesTQ?.length > 0
        ? [...favoritesTQ].sort(
            (a: { index: number }, b: { index: number }) =>
              favoriteSlotOrder(a.index) - favoriteSlotOrder(b.index)
          )
        : [];
    const favs =
      sortedFavorites.length > 0
        ? {
            title: "Favorite Boards",
            indexes: sortedFavorites.map(
              (favorite: { index: number }) => favorite.index
            ),
            projects: sortedFavorites.map(
              (favorite: { project: IProject }) => favorite.project
            ) as IProject[],
            group: "Favs" as Tgroup,
          }
        : null;

    // Process teams with sorting
    let teams =
      allTeamsTQ?.map((team: any) => ({ ...team, group: "Teams" })) || [];

    let newState = [];
    newState.push(favs);

    // Team grouping is the fallback, not a matched case: boardSortMode is persisted
    // to localStorage, so a value written by an older build (or hand-edited) used to
    // match neither branch and left the sidebar showing favorites and nothing else.
    if (boardSortMode !== "lastUsed") {
      // Most-used team first, boards within it by id: same order the
      // Alt+Shift+Arrow team-cycle shortcut walks (src/lib/teamSwitcherOrder.ts).
      teams = orderTeamsForSwitcher(teams, lastUsedBoards);

      newState = [...newState, ...teams].filter(Boolean);
    } else {
      // Flatten all teams into a single list of boards
      const allBoards: IProject[] = teams
        .map((team: any) => team.projects || [])
        .flat();

      // Sort all boards by last used (most recent first)
      const sortedBoards = allBoards.sort((a: IProject, b: IProject) => {
        const timeA = lastUsedBoards[a.id] || 0;
        const timeB = lastUsedBoards[b.id] || 0;
        return timeB - timeA; // Most recent first
      });

      // Create a single group for all boards (no team grouping)
      if (sortedBoards.length > 0) {
        newState.push({
          title: "All Boards",
          projects: sortedBoards,
          group: "Teams" as Tgroup,
        });
      }
      newState = newState.filter(Boolean);
    }

    setFavsAndTeams(newState);

    // Use filterData to handle all derived state updates in one place
    // Pass current keyword to maintain any active search filtering
    const tempFilteredData = newState
      .map((group) => {
        if (group.projects) {
          const filteredProjects = group.projects.filter(
            (project: { title: string }) =>
              project.title?.toLowerCase().includes(keyword?.toLowerCase())
          );
          if (filteredProjects.length > 0) {
            return { ...group, projects: filteredProjects };
          }
          return null;
        }
        return group;
      })
      .filter(Boolean);

    setFilteredFavsandTeams(tempFilteredData);

    // Set selectedProject and currentGroup from filtered data
    if (tempFilteredData.length > 0) {
      // Find the first group that contains the currentProject and set both selectedProject and currentGroup accordingly
      let selectedProjectValue: IProject | null = null;
      let foundGroup: Tgroup | undefined = undefined;

      if (currentProject?.id) {
        for (const group of tempFilteredData) {
          if (
            group.projects &&
            group.projects.some((item: any) => item.id === currentProject.id)
          ) {
            selectedProjectValue = group.projects.find(
              (item: any) => item.id === currentProject.id
            );
            foundGroup = group.group;
            break;
          }
        }
      }

      // If not found, fallback to first project in first group (if exists)
      if (
        !selectedProjectValue &&
        tempFilteredData.length > 0 &&
        tempFilteredData[0].projects?.length > 0
      ) {
        selectedProjectValue = tempFilteredData[0].projects[0];
        foundGroup = tempFilteredData[0].group;
      }

      setSelectedProject(selectedProjectValue || null);
      if (foundGroup && currentGroup !== foundGroup) {
        setCurrentGroup(foundGroup);
      }

      if (tempFilteredData[0].group === "Favs") {
        setFilterdFavorutes(tempFilteredData[0]);
        setFitleredAllProjects(
          tempFilteredData
            .slice(1)
            .map((item: { projects: IProject[] }) => item.projects)
            .flat() ?? []
        );
      } else {
        setFilterdFavorutes(null);
        setFitleredAllProjects(
          tempFilteredData
            .map((item: { projects: IProject[] }) => item.projects)
            .flat()
        );
      }
    } else {
      setFilterdFavorutes(null);
      setFitleredAllProjects([]);
    }
  }

  useEffect(() => {
    document.addEventListener("keydown", keyDownHandler);
    return () => {
      document.removeEventListener("keydown", keyDownHandler);
    };
  }, [
    _showBoardManager,
    currentProject,
    selectedProject,
    filterdFavorites,
    keyword,
    filteredAllProjects,
    favoritesTQ,
  ]);

  // ------- on favorites update from server
  useEffect(() => {
    onCacheUpdate();
  }, [favoritesTQ, allTeamsTQ, boardSortMode, lastUsedBoards]);

  useEffect(() => {
    document.getElementById("boardManager")?.focus();

    document.addEventListener("click", handleOutSideClick, true);
    return () => {
      document.removeEventListener("click", handleOutSideClick, true);
    };
  }, []);

  // Warm only the board the user is actively considering. Query prefetching
  // deduplicates repeated hover/focus events and replaces the previous
  // account-wide background fetch of every board.
  useEffect(() => {
    if (!_showBoardManager || !selectedProject || selectedProject.id === currentProject?.id) return;
    void prefetchBoard(queryClient, selectedProject.id, currentUser.id);
  }, [_showBoardManager, currentProject?.id, currentUser.id, queryClient, selectedProject]);

  const firstBoardGroupIndex = filteredFavsandTeams?.findIndex(
    (item: ISidebarFavs) => item.group !== "Favs"
  );

  return (
    <BackDropContainer>
      <div
        ref={sidebarRef}
        onMouseLeave={hanleMouseLeave}
        className="left-sidebar-flyout fixed shadow-customshadow-2  flex flex-col justify-between bg-sidebar sm:max-w-[461px] w-[80vw]  h-SVH-full top-0 left-0 text-white-black pt-[env(safe-area-inset-top)]"
      >
        <HypertaskUser
          toggleBoard={setShowBoardManager}
          currentUser={currentUser}
        />

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
            <div className="mx-[16px] mb-3 flex items-center rounded-[4px] bg-modalBackground px-3 py-2">
              <input
                className="text-content bg-transparent outline-none font-normal flex-1 min-w-0 placeholder:text-text-muted"
                id="boardManager"
                autoFocus
                placeholder="Search boards"
                autoComplete="off"
                style={{
                  backgroundColor: "transparent",
                  outline: "none",
                  caretColor: "var(--color-white-black)",
                }}
                onChange={onKeyChange}
                value={keyword}
              />
            </div>
            <DragDropContext onDragEnd={onFavoritesDragEnd}>
            <div className="flex flex-col gap-4 favsAndTeamsContainer">
              {filteredFavsandTeams?.map(
                (item: ISidebarFavs, favidx: number) => (
                  <>
                    {/* the toggle only regroups the boards below favorites, so it sits directly above them */}
                    {item.group !== "Favs" &&
                      favidx === firstBoardGroupIndex && (
                        <div
                          key="board-sort-row"
                          className="flex items-center justify-between px-[16px] pt-3 border-t border-white/5"
                        >
                          <span className="text-content font-semibold uppercase tracking-wider text-text-light-gray">
                            Group by
                          </span>
                          <SortDropdown
                            selectedView={boardSortMode}
                            onSortChange={setBoardSortMode}
                          />
                        </div>
                      )}
                    <div
                      key={`favs-and-teams-left-sidebar-${favidx}`}
                      className=""
                    >
                      {/* ========================= TEAM TITLE ====================== */}
                      <GroupTitle
                        item={item}
                        toggleBoard={setShowBoardManager}
                        isFavoritesExpanded={isFavoritesExpanded}
                        setIsFavoritesExpanded={setIsFavoritesExpanded}
                        currentSortMode={boardSortMode}
                      />

                      {/* ========================= TEAM allProjects ====================== */}
                      <Droppable
                        droppableId={
                          item.group === "Favs"
                            ? "favorites"
                            : `team-${favidx}`
                        }
                      >
                        {(dropProvided) => (
                          <div
                            ref={dropProvided.innerRef}
                            {...dropProvided.droppableProps}
                            className={`mt-2 transition-all duration-200 ${
                              item.group === "Favs" && !isFavoritesExpanded
                                ? "hidden"
                                : ""
                            }`}
                          >
                            {item.projects &&
                              item.projects.map(
                                (project: IProject, prjIndex: number) => (
                                  <Draggable
                                    draggableId={`${
                                      item.group === "Favs" ? "fav" : "board"
                                    }-${project.id}`}
                                    index={prjIndex}
                                    isDragDisabled={!!keyword}
                                    key={`left-sidebar-project-${item.group}-${project.id}`}
                                  >
                                    {(dragProvided, dragSnapshot) => (
                                      <div
                                        ref={dragProvided.innerRef}
                                        {...dragProvided.draggableProps}
                                        {...dragProvided.dragHandleProps}
                                        id={`project-${project.id}`}
                                        className={`cursor-pointer px-[16px] py-2 flex gap-1 items-center ${
                                          dragSnapshot.isDragging
                                            ? "bg-active-list-element rounded-[4px]"
                                            : selectedProject &&
                                              currentGroup === item.group &&
                                              selectedProject.id === project.id
                                            ? "bg-active-list-element"
                                            : "transparent"
                                        }`}
                                        onClick={() => {
                                          // Track board usage
                                          setLastUsedBoards((prev) => ({
                                            ...prev,
                                            [project.id]: Date.now(),
                                          }));
                                          markBoardSwitchIntent({ surface: "sidebar", projectId: project.id });
                                          goToProjectShortcut(project.id, true);
                                          setShowBoardManager(false);
                                          setActiveItem(null);
                                        }}
                                        onMouseOver={() => {
                                          setSelectedProject(project);
                                          setCurrentGroup(item.group as Tgroup);
                                        }}
                                        onFocus={() => {
                                          setSelectedProject(project);
                                          setCurrentGroup(item.group as Tgroup);
                                        }}
                                        onTouchStart={() => {
                                          if (project.id !== currentProject?.id) {
                                            void prefetchBoard(queryClient, project.id, currentUser.id);
                                          }
                                        }}
                                      >
                                        <TitleAndMembers
                                          project={project}
                                          hyperAI={hyperAI}
                                        />
                                        {item.group === "Favs" && !mbl && (
                                          <CTRL_INDEX
                                            isApple={!isApple ? "ALT" : "CTRL"}
                                            index={item.indexes[prjIndex]}
                                          />
                                        )}
                                      </div>
                                    )}
                                  </Draggable>
                                )
                              )}
                            {dropProvided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  </>
                )
              )}
            </div>
            </DragDropContext>
          </>
        </div>
      </div>
    </BackDropContainer>
  );
}

const GroupTitle = ({
  item,
  toggleBoard,
  isFavoritesExpanded,
  setIsFavoritesExpanded,
  currentSortMode,
}: {
  item: ISidebarFavs;
  toggleBoard: SetterOrUpdater<boolean>;
  isFavoritesExpanded?: boolean;
  setIsFavoritesExpanded?: (expanded: boolean) => void;
  currentSortMode: "teams" | "lastUsed";
}) => {
  const [_, setShowCommands] = useRecoilState(showCommandsAtom);

  const closHandler = () => {
    toggleBoard(false);
    setShowCommands({
      show: true,
      mode: CommandMode.NewBoard,
      payload:
        currentSortMode === "lastUsed"
          ? undefined
          : { teamId: item.id, googleAccountId: item.googleAccountId },
    });
  };

  const handleFavoritesToggle = () => {
    if (item.group === "Favs" && setIsFavoritesExpanded) {
      setIsFavoritesExpanded(!isFavoritesExpanded);
    }
  };

  return (
    <div
      className={`group flex text-content items-center gap-2 pl-[16px]  ${
        item.group === "Favs" ? "cursor-pointer w-fit" : ""
      }`}
    >
      <span
        className={
          item.title === "Favorite Boards" || item.title === "All Boards"
            ? "text-content font-semibold uppercase tracking-wider text-text-light-gray"
            : "font-semibold"
        }
        onClick={item.group === "Favs" ? handleFavoritesToggle : undefined}
      >
        {item.title}
      </span>
      {item.group === "Favs" && (
        <span
          className="text-content text-text-muted"
          onClick={handleFavoritesToggle}
        >
          {item.projects?.length ?? 0}
        </span>
      )}
      {/* chevron and gear stay hidden until the row is hovered — the header itself is the toggle.
          NOTE: opacity-[0], not opacity-0 — bootstrap (imported globally in layout.tsx) ships
          .opacity-0 {opacity: 0 !important}, which no group-hover class can override. */}
      {item.group === "Favs" && setIsFavoritesExpanded && (
        <ChevronRight size={14}
          onClick={handleFavoritesToggle}
          className="text-content cursor-pointer text-text-muted opacity-[0] transition-all duration-150 group-hover:opacity-100"
          strokeWidth={1.75}
          style={{
            transform: isFavoritesExpanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />
      )}
      {item.group === "Favs" && (
        <Settings size={14}
          onClick={() => {
            toggleBoard(false);
            setShowCommands({
              show: true,
              mode: CommandMode.ManageFavorites,
            });
          }}
          className="text-content mb-[1px] cursor-pointer text-text-muted opacity-[0] transition-opacity duration-150 group-hover:opacity-100 hover:!text-white-black"
          strokeWidth={1.75}
        />
      )}
      {item.group !== "Favs" && (
        <Plus size={14}
          onClick={closHandler}
          className="text-content mb-[2px] cursor-pointer text-text-muted"
          strokeWidth={1.75}
        />
      )}
    </div>
  );
};

const CTRL_INDEX = ({
  isApple,
  index,
}: {
  isApple: "ALT" | "CTRL";
  index: any;
}) => {
  return (
    <div className="flex-grow justify-end mr-4 flex gap-1  text-content font-bold text-white-black">
      <kbd
        className={` py-[1px] mx-[1.5px] h-fit rounded-[2px]  border-gray-200 bg-[#555B64] dark:border-gray-500`}
      >
        {isApple}
      </kbd>
      <kbd
        className={`px-1 py-[1px] mx-[1.5px] h-fit rounded-[2px]  border-gray-200 bg-[#555B64]  dark:border-gray-500`}
      >
        {index}
      </kbd>
    </div>
  );
};

// ==================================== CURRENT USER COMPONENT
const HypertaskUser = ({
  currentUser,
  toggleBoard,
}: {
  currentUser: IUser;
  toggleBoard: SetterOrUpdater<boolean>;
}) => {
  const { openSettings } = useSettingsNavigation();
  // Hosted by GloablProviders via this atom: mounting the modal inside the
  // sidebar would fight its click-away/Escape handling, and the commands host
  // is not mounted on every route this sidebar opens on (/inbox, /drafts…).
  const setShowAccountSwitcher = useSetRecoilState(showAccountSwitcherAtom);

  const closHandler = () => {
    toggleBoard(false);
  };
  return (
    <div className="text-white-black flex w-full items-center !px-4 pt-4 pb-2">
      <div
        className="cursor-pointer"
        onClick={() => {
          closHandler();
          openSettings("general");
        }}
      >
        <UserAvatar
          alt={`${currentUser.displayName || currentUser.email || "Current user"} avatar`}
          name={currentUser.displayName || currentUser.email}
          photoURL={currentUser.photoURL}
          size={32}
          title={currentUser.displayName || currentUser.email}
        />
      </div>

      <button
        type="button"
        onClick={() => {
          closHandler();
          setShowAccountSwitcher(true);
        }}
        className="min-w-0 flex-1 cursor-pointer truncate rounded-[5px] text-left text-content font-medium hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
        style={{
          padding: "4px 16px",
          margin: "-4px 0",
        }}
      >
        {currentUser.email}
      </button>
    </div>
  );
};

// ==================================== TITLE AND MEMBERS
const TitleAndMembers = ({
  project,
  hyperAI,
}: {
  project: IProject;
  hyperAI: IUser | undefined;
}) => {
  const humanMembers = project.members.filter((member) => !member.agent);
  // Prefer the server-side agent count (accurate even when the members list is
  // capped for avatars, e.g. the Teams/Recent query's take:8). Fall back to
  // counting the array for queries that return every member (favorites).
  const agentCount =
    project._count?.members ?? project.members.length - humanMembers.length;

  return (
    <>
      {/* --------------------- PROJECT TITLE ------------------ */}

      <span className="text-content mr-4 font-normal text-white-black">
        {project.title ? project.title : `${project.name}`}
      </span>

      <>
        <UserAvatar
          alt=""
          className="ml-[-12px]"
          name={project.owner.displayName || project.owner.email}
          photoURL={project.owner.photoURL}
          size={16}
          title={project.owner.displayName || project.owner.email}
        />
        {/* Only human members get a face. Agents all share the owner's photo,
            so instead of repeating the owner's face per agent we show one
            "+ robot N" indicator (the same agent icon used elsewhere). */}
        {humanMembers.map((member, idx) => (
          <UserAvatar
            key={`member-avatar-left-sidebar-${idx}`}
            alt=""
            className="ml-[-12px]"
            name={member.user?.displayName || member.user?.email}
            photoURL={member.user?.photoURL}
            size={16}
            title={member.user?.displayName || member.user?.email}
          />
        ))}
        {hyperAI && (
          <UserAvatar
            alt=""
            className="ml-[-12px]"
            name={hyperAI.displayName}
            photoURL={hyperAI.photoURL}
            size={16}
            title={hyperAI.displayName}
          />
        )}
        {agentCount > 0 && (
          <span
            title={`${agentCount} AI agent${agentCount === 1 ? "" : "s"}`}
            className="ml-[6px] flex items-center gap-[3px] text-content text-icon-dark-gray leading-none"
          >
            +
            <FaRobot className="w-4 h-4" />
            {agentCount}
          </span>
        )}
      </>
    </>
  );
};

export default LeftSidebar;

const sortOptions: { label: string; value: "teams" | "lastUsed" }[] = [
  {
    label: "Teams",
    value: "teams",
  },
  {
    label: "Recent",
    value: "lastUsed",
  },
];

const SortDropdown = ({
  onSortChange,
  selectedView,
}: {
  selectedView: "teams" | "lastUsed";
  onSortChange: (mode: "teams" | "lastUsed") => void;
}) => {
  return (
    <div className="flex flex-shrink-0 rounded-[4px] bg-cardBackground p-[2px] text-content">
      {sortOptions.map((option) => (
        <button
          key={`board-sort-${option.value}`}
          className={`px-2 py-0.5 rounded-[2px] transition-colors duration-75 ${
            selectedView === option.value
              ? "bg-kanban-active-cardbg text-white-black font-medium"
              : "text-text-muted hover:text-white-black"
          }`}
          onClick={() => onSortChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};
