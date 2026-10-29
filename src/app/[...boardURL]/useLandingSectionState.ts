import { HTPR_7865_AGENT_CREATOR_FILTER_FLAG } from "@/lib/flags/definitions/htpr-7865-agent-creator-filter";
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
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7807_EMPTY_VIEW_COLUMNS_FLAG, HTPR_7725_SAVED_VIEW_ASSIGNEE_FLAG } from "@/lib/flags/keys";
import { HTPR_7776_DEFAULT_VIEW_FILTERS_FLAG } from "@/lib/flags/keys";
import type { SectionCompProps } from "./LandingPageSection";

type Context = Pick<SectionCompProps, "_allProjects" | "_boardLayout" | "_projectIndex" | "_currentUser" | "_readinessProjectId" | "_readinessRouteEntryId" | "_authenticated" | "_localDatabasePilotEnabled" | "_readinessSource">;

export function useLandingSectionState(context: Context) {
  const {
  _allProjects, _boardLayout, _projectIndex, _currentUser, _readinessProjectId,
  _readinessRouteEntryId, _authenticated, _localDatabasePilotEnabled, _readinessSource,
  } = context;


const agentCreatorFilterEnabled = useFlag(HTPR_7865_AGENT_CREATOR_FILTER_FLAG);
const showEmptyViewColumns = useFlag(HTPR_7807_EMPTY_VIEW_COLUMNS_FLAG);
const assigneeFixEnabled = useFlag(HTPR_7725_SAVED_VIEW_ASSIGNEE_FLAG);
const defaultFiltersFixEnabled = useFlag(HTPR_7776_DEFAULT_VIEW_FILTERS_FLAG);
const router = useRouter();
const queryClient = useQueryClient();
const {
  markBoardUsable,
  releaseSecondaryStartup,
  secondaryStartupEnabled,
} = useBoardStartup();
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
  legacyAgentAssigneeMatch: !assigneeFixEnabled,
  agentCreatorFilterEnabled,
  legacyMissingPersonalViewFilters: !defaultFiltersFixEnabled,
  runningTaskIds: timerDataReady
    ? new Set(runningTimers.keys())
    : new Set(sections.flatMap((section) =>
        (section.items ?? []).map((task) => task.id)
      )),
}), [agentCreatorFilterEnabled, assigneeFixEnabled, defaultFiltersFixEnabled, runningTimers, sections, timerDataReady]);

useEffect(() => {
  const project = _allProjects?.[_projectIndex]
  if (project?.teamId) setLastBoardTeam(project.teamId)
}, [_allProjects, _projectIndex])

const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom);
const filteredSectionsForActiveView = useMemo(() => {
  const persistedFilteredSections = _allProjects?.[_projectIndex]?.filteredSections ?? [];
  if (!_currentProject) return persistedFilteredSections;

  const activeViewId = getActiveBoardViewId(_currentProject, activeBuiltinViews);
  const filtered = getFilteredSections(
    sections,
    _currentProject,
    isBuiltinViewId(activeViewId) ? activeViewId : undefined,
    buildBuiltinViewContext(_currentProject, _currentUser.id, undefined, _currentUser.displayName),
    filterRuntimeContext,
  );
  const subtaskSections = getAppliedSubtaskSections(filtered, _currentProject);
  return showEmptyViewColumns
    ? getFilteredEmptySections(subtaskSections, _currentProject, true)
    : getFilteredEmptySections(subtaskSections, _currentProject);
}, [
  _allProjects,
  _currentProject,
  _currentUser.id,
  _projectIndex,
  activeBuiltinViews,
  filterRuntimeContext,
  sections,
  showEmptyViewColumns,
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
