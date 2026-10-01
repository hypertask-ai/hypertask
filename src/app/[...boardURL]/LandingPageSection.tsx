import type { useLandingSectionReadiness } from "./LandingPage";

import { useLandingSectionState } from "./useLandingSectionState";
import { useCommittedBoardReadinessTrace } from "./LandingPageShared";
import { IUser } from "@/models/model";


import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { debounce } from "@/utils/helperFunctions/helperFunctions";


import { useGetAllFavorites } from "@/hooks/MultiPages/useGetAllFavorites";


import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";
import { getViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { TBoardSortingViewMode } from "@/models/Views/model";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import useViewCyclingShortcuts from "@/hooks/Homepage/Views/useViewCyclingShortcuts";





import { getActiveBoardViewId, getBuiltinView } from "@/lib/constants/builtinViews";
import { buildBoardDocumentTitle } from "@/lib/boardDocumentTitle";




import { completeBoardReadinessTrace, emitBoardReadinessAfterPaint, markBoardReadinessPhase } from "@/lib/analytics/boardReadinessPhases";
import { markBoardSwitchIntent, resolveBoardSwitchIntent } from "@/lib/analytics/boardSwitchLatency";
export const useLandingSection = ({
  _notifications,
  _allProjects,
  _currentUser, 
  _projectIndex,
  _activeSortingMode,
  _authenticated,
  _localDatabasePilotEnabled,
  _boardLayout,
  _readinessSource,
  _readinessProjectId,
  _readinessRouteEntryId,
}:SectionCompProps, useReadinessHook: typeof useLandingSectionReadiness) =>{
  const {
  markBoardUsable, releaseSecondaryStartup, secondaryStartupEnabled, projects, setShowBoardManager,
  boardLayout, isMbl, appShellRailOn, showQuickTips, _currentProject,
  setRecoilCurrentProject, sections, setShowTrial, showTrial, activeBuiltinViews,
  filteredSectionsForActiveView, favorites, setFavorites, setHasHorizontalScrollbar, kanbanContainerRef,
  restoredScrollForProject, restoringScroll, readinessFrameRef, readinessPaintFrameRef, readinessEntryKey,
  readinessCompletionRef,
  } = useLandingSectionState({
    _allProjects, _boardLayout, _projectIndex, _currentUser, _readinessProjectId,
    _readinessRouteEntryId, _authenticated, _localDatabasePilotEnabled, _readinessSource,
  });
const boardReadinessTraceScope = useCommittedBoardReadinessTrace({
  accountId: _currentUser.id,
  projectId: _readinessProjectId,
  routeEntryId: _readinessRouteEntryId,
});
useReadinessHook({
  boardReadinessTraceScope, _currentProject, _allProjects, _projectIndex, readinessCompletionRef,
  readinessFrameRef, readinessPaintFrameRef, markBoardUsable, releaseSecondaryStartup, readinessEntryKey,
});

const {data:favoritesTQ} = useGetAllFavorites(
  _currentUser.UserSettingId,
  { enabled: secondaryStartupEnabled },
)
const { goToProjectShortcut } = useProjectQuery()
useGetAllTeamsMinimal(_currentUser?.id ?? null, undefined, {
  enabled: secondaryStartupEnabled,
})
useViewCyclingShortcuts(_currentProject)

// console.log("🚀 ~ file: [...boardURL].tsx:46 ~ currentProject:", projectSections) 



// ================== fetch Sections on server and pass down the component
      // ------- on favorites update
  useEffect(()=>{
    setFavorites(favoritesTQ)
  },[favoritesTQ])


// ================= update tab title
  useEffect(()=>{
    const builtinView = getBuiltinView(
      getActiveBoardViewId(_currentProject, activeBuiltinViews),
    );
    const savedView = getViewFromProject(_currentProject);
    const viewTitle =
      builtinView?.title ??
      (savedView?.type === "Default" ? undefined : savedView?.view.title);
    document.title = buildBoardDocumentTitle(_currentProject.title, viewTitle)
    // mixPageTrack({
    //   team_name: _currentProject.team.title,
    //   team_id: _currentProject.team.id,
    //   page: "Kanban"
    // })

  },[_currentProject, activeBuiltinViews])

// Local state already targets the incoming board before descendants reconcile.
// Keep only the shared atom synchronized before paint for external consumers.
useLayoutEffect(() => {
  const project = _allProjects?.[_projectIndex] ?? null
  setRecoilCurrentProject((current) => current === project ? current : project)
}, [_allProjects, _projectIndex, setRecoilCurrentProject])

// ================= detect horizontal scrollbar
useEffect(() => {
  const checkScrollbar = () => {
    if (kanbanContainerRef.current) {
      const hasScroll = kanbanContainerRef.current.scrollWidth > kanbanContainerRef.current.clientWidth;
      setHasHorizontalScrollbar(hasScroll);
    }
  };

  checkScrollbar();

  const resizeObserver = new ResizeObserver(() => {
    checkScrollbar();
  });

  if (kanbanContainerRef.current) {
    resizeObserver.observe(kanbanContainerRef.current);
  }

  window.addEventListener('resize', checkScrollbar);

  return () => {
    resizeObserver.disconnect();
    window.removeEventListener('resize', checkScrollbar);
  };
}, [sections, _currentProject]);

// ================= remember board horizontal scroll position across card navigation
useEffect(() => {
  const projectId = _currentProject?.id;
  if (!projectId) return;
  const key = `board-scroll-${projectId}`;

  const save = () => {
    // don't clobber the stored target while we're re-applying it
    if (restoringScroll.current) return;
    sessionStorage.setItem(key, JSON.stringify({
      c: kanbanContainerRef.current?.scrollLeft ?? 0,
      w: window.scrollX,
    }));
  };

  // restore once per project, but only after its columns have rendered.
  // The board can paint empty for a frame on remount, so re-apply across a
  // few animation frames until the scroller is wide enough for it to stick.
  if (restoredScrollForProject.current !== projectId && sections?.length) {
    restoredScrollForProject.current = projectId;
    const raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        const { c = 0, w = 0 } = JSON.parse(raw);
        restoringScroll.current = true;
        let tries = 0;
        const apply = () => {
          const box = kanbanContainerRef.current;
          if (box) box.scrollLeft = c;
          window.scrollTo(w, window.scrollY);
          const boxOk = !box || box.scrollLeft === c || box.scrollWidth - box.clientWidth <= c;
          const winOk = window.scrollX === w || document.documentElement.scrollWidth - window.innerWidth <= w;
          if ((!boxOk || !winOk) && tries++ < 20) requestAnimationFrame(apply);
          else restoringScroll.current = false;
        };
        requestAnimationFrame(apply);
      } catch { restoringScroll.current = false; }
    }
  }

  const el = kanbanContainerRef.current;
  el?.addEventListener('scroll', save, { passive: true });
  window.addEventListener('scroll', save, { passive: true });
  return () => {
    el?.removeEventListener('scroll', save);
    window.removeEventListener('scroll', save);
  };
}, [sections, _currentProject]);

function handleSideBar(){
  setShowBoardManager((prevState:boolean)=>!prevState);
}

// HTPR-6072: navigation lets the parent authorize and hydrate the target before publishing it.
function handleStateChangesOnBoardChange (index:number){
  const target = projects[index]
  if (target) goToProjectShortcut(target.id, true)
}


const handleBoardChange = (idx:number) => {
  const favoritesindex = favorites?.findIndex(favorite=>favorite.index===idx)
  if (favoritesindex<0)return ;
  const index = projects.findIndex((project: { id: number; })=>project.id===favorites[favoritesindex].projectId)
  if (index < 0) return;
  markBoardSwitchIntent({ surface: "keyboard_shortcut", projectId: favorites[favoritesindex].projectId })
  return handleStateChangesOnBoardChange(index)
  }

const handleBoardChangeRef = useRef(handleBoardChange);
handleBoardChangeRef.current = handleBoardChange;

const debouncedHandleBoardChange = useMemo(
  () =>
    debounce((idx: number) => {
      handleBoardChangeRef.current(idx);
    }, 50),
  []
);
  return {
  boardLayout, isMbl, appShellRailOn, showQuickTips, _currentProject,
  sections, setShowTrial, showTrial, activeBuiltinViews, filteredSectionsForActiveView,
  kanbanContainerRef, handleSideBar, handleBoardChange, debouncedHandleBoardChange, _notifications,
  _currentUser, _activeSortingMode,
  };
};

export type SectionCompProps = {
  _notifications:any,
  _allProjects:any,
  _projectCount:number,
  _currentUser:IUser, 
  _projectIndex:number,
  _activeSortingMode: TBoardSortingViewMode,
  _authenticated:boolean,
  _localDatabasePilotEnabled:boolean,
  _boardLayout:"board" | "table",
  _readinessSource:"indexeddb" | "network" | "unknown",
  _readinessProjectId:number,
  _readinessRouteEntryId:number,
};
