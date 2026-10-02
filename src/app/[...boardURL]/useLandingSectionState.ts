import { IFavorites, IProject, ISection } from "@/models/model";
import { activeBuiltinViewsAtom, showBoardManagerAtom, currentProjectAtom, isXScrollOnKanbanAtom, appShellRailAtom, showQuickTipsAtom } from "@/store";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { deepCopy } from "@/utils/helperFunctions/helperFunctions";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import useTrialModal from "@/hooks/MultiPages/Route/useTrialModal";
import { getFilteredSections } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { getAppliedSubtaskSections } from "@/utils/helperFunctions/Views/SubtaskHelperFunction";
import { getFilteredEmptySections } from "@/utils/helperFunctions/Views/EmptySectionsHelperFunction";
import { buildBuiltinViewContext, getActiveBoardViewId, isBuiltinViewId } from "@/lib/constants/builtinViews";
import { useBoardRunningTimers } from "@/hooks/Task Detail/useTimeTracking";
import { useBoardStartup } from "@/lib/contexts/boardStartupContext";
import { setLastBoardTeam } from "@/lib/lastBoardTeam";
import type { SectionCompProps } from "./LandingPageSection";

type Context = Pick<SectionCompProps, "_allProjects" | "_boardLayout" | "_projectIndex" | "_currentUser" | "_readinessProjectId" | "_readinessRouteEntryId" | "_authenticated" | "_localDatabasePilotEnabled" | "_readinessSource">;

export function useLandingSectionState(context: Context) {
  const {
  _allProjects, _boardLayout, _projectIndex, _currentUser, _readinessProjectId,
  _readinessRouteEntryId, _authenticated, _localDatabasePilotEnabled, _readinessSource,
  } = context;


const router = useRouter();
const queryClient = useQueryClient();
const {
  markBoardUsable,
  releaseSecondaryStartup,
  secondaryStartupEnabled,
} = useBoardStartup();
// const _allProjects = JSON.parse(_allStringifiedProjects)
const [projects, setProjects]= useState<IProject[]>(_allProjects)
const [showBoardManager, setShowBoardManager] = useRecoilState(showBoardManagerAtom);
const boardLayout = _boardLayout;
const isMbl = useContext(MobileViewContext);
const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
const showQuickTips = useRecoilValue(showQuickTipsAtom);
const [_currentProject,setCurrentProject] = useState( _allProjects && _projectIndex >= 0 ? _allProjects[_projectIndex] : null)
const setRecoilCurrentProject = useSetRecoilState(currentProjectAtom)
const [sections, setSections] = useState<ISection[]>(deepCopy(_allProjects && _projectIndex >= 0 ? _allProjects[_projectIndex]?.sections : []));
const [currentIndex, setCurrentIndex] = useState<number>(_projectIndex);
// Adjusting state during render makes React restart SectionComp before it
// reconciles descendants, instead of rendering the old board tree and then
// forcing the whole tree through a synchronous layout-effect render.
const [syncedBoardInput, setSyncedBoardInput] = useState({
  projects: _allProjects,
  projectIndex: _projectIndex,
});
if (
  syncedBoardInput.projects !== _allProjects ||
  syncedBoardInput.projectIndex !== _projectIndex
) {
  const nextProject = _allProjects?.[_projectIndex] ?? null;
  setSyncedBoardInput({ projects: _allProjects, projectIndex: _projectIndex });
  setProjects(_allProjects);
  setCurrentProject(nextProject);
  setSections(nextProject?.sections ?? []);
  setCurrentIndex(_projectIndex);
}
const { setShowTrial, showTrial } = useTrialModal(_currentProject);
const { timers: runningTimers, timerDataReady } = useBoardRunningTimers(
  _currentProject?.id ?? null,
  { enabled: secondaryStartupEnabled },
);
const filterRuntimeContext = useMemo(() => ({
  // A running-only saved view must not render as empty while its deferred timer
  // data is unavailable. Treat every task as a match until cached/network data
  // can answer the filter accurately.
  runningTaskIds: timerDataReady
    ? new Set(runningTimers.keys())
    : new Set(sections.flatMap((section) =>
        (section.items ?? []).map((task) => task.id)
      )),
}), [runningTimers, sections, timerDataReady]);

useEffect(() => {
  const project = _allProjects?.[_projectIndex]
  if (project?.teamId) setLastBoardTeam(project.teamId)
}, [_allProjects, _projectIndex])

const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom);
const filteredSectionsForActiveView = useMemo(() => {
  const persistedFilteredSections = _allProjects?.[_projectIndex]?.filteredSections ?? [];
  if (!_currentProject) return persistedFilteredSections;

  // HTPR-5021: filteredSections is baked by the server for whichever view was
  // applied when getAll ran. Switching a saved view updates project_view in the
  // cache but never regenerates that array, so the board kept rendering the
  // PREVIOUS view's tasks until a refetch. Built-in views were unaffected only
  // because they already recomputed here. Recompute for saved views too, so the
  // rendered set always matches the view that is actually applied.
  const activeViewId = getActiveBoardViewId(_currentProject, activeBuiltinViews);
  const filtered = getFilteredSections(
    sections,
    _currentProject,
    isBuiltinViewId(activeViewId) ? activeViewId : undefined,
    buildBuiltinViewContext(_currentProject, _currentUser.id),
    filterRuntimeContext,
  );
  return getFilteredEmptySections(
    getAppliedSubtaskSections(filtered, _currentProject),
    _currentProject,
  );
}, [
  _allProjects,
  _currentProject,
  _currentUser.id,
  _projectIndex,
  activeBuiltinViews,
  filterRuntimeContext,
  sections,
]);

const [favorites, setFavorites] = useState<IFavorites[]>([]);
const [hasHorizontalScrollbar, setHasHorizontalScrollbar] = useRecoilState(isXScrollOnKanbanAtom);
const kanbanContainerRef = useRef<HTMLDivElement>(null);
const restoredScrollForProject = useRef<number | null>(null);
const restoringScroll = useRef(false);
const readinessFrameRef = useRef<number | null>(null);
const readinessPaintFrameRef = useRef<number | null>(null);
const readinessEntryKey = `${_currentUser.id}:${_readinessProjectId}:${_readinessRouteEntryId}`;
const readinessCompletionRef = useRef({
  entryKey: readinessEntryKey,
  accountId: _currentUser.id,
  projectId: _readinessProjectId,
  authenticated: _authenticated,
  localDatabasePilot: _localDatabasePilotEnabled,
  readinessSource: _readinessSource,
  viewSurface: boardLayout,
});
// HTPR-6072: SectionComp no longer remounts on a board switch, so this ref's
// one-time useRef initializer would otherwise stay pinned to the first
// board forever. Recreate it whenever the readiness entry changes, but
// leave it untouched (frozen) for re-renders within the same entry. A
// layout effect (not a render-time write) so it runs once per entry,
// before the readiness completion effect below reads it.
useLayoutEffect(() => {
  if (readinessCompletionRef.current.entryKey === readinessEntryKey) return;
  readinessCompletionRef.current = {
    entryKey: readinessEntryKey,
    accountId: _currentUser.id,
    projectId: _readinessProjectId,
    authenticated: _authenticated,
    localDatabasePilot: _localDatabasePilotEnabled,
    readinessSource: _readinessSource,
    viewSurface: boardLayout,
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [readinessEntryKey]);
  return {
  markBoardUsable, releaseSecondaryStartup, secondaryStartupEnabled, projects, setShowBoardManager,
  boardLayout, isMbl, appShellRailOn, showQuickTips, _currentProject,
  setRecoilCurrentProject, sections, setShowTrial, showTrial, activeBuiltinViews,
  filteredSectionsForActiveView, favorites, setFavorites, setHasHorizontalScrollbar, kanbanContainerRef,
  restoredScrollForProject, restoringScroll, readinessFrameRef, readinessPaintFrameRef, readinessEntryKey,
  readinessCompletionRef,
  };
}
