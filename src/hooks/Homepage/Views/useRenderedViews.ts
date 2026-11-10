import { HTPR_7865_AGENT_CREATOR_FILTER_FLAG } from "@/lib/flags/definitions/htpr-7865-agent-creator-filter";
import { useMemo } from 'react'
import { useRecoilValue } from '@/lib/state'
import { IProject, ISection, IView } from '@/models/model'
import { activeBuiltinViewsAtom, currentUserAtom, hiddenViewTabIdsAtom, showEmptyViewTabsAtom } from '@/store'
import { getActiveColumnsViewFromProject } from '@/utils/helperFunctions/Views/ViewsHelperFunctions'
import { countTasksInSavedView } from '@/lib/savedViews/savedViewTaskCounts'
import {
  BoardView,
  BUILTIN_VIEWS,
  BUILTIN_VIEW_IDS,
  buildBuiltinViewContext,
  getActiveBoardViewId,
  getBlockedByMeSections,
  isBuiltinView,
  viewTabPreferenceKey,
} from '@/lib/constants/builtinViews'
import useOrderedViews from './useOrderedViews'
import { useBoardRunningTimers } from '@/hooks/Task Detail/useTimeTracking'
import { useFlag } from '@/hooks/useFlag'
import { HTPR_8826_BLOCKED_BY_ME_LIST_FLAG, HTPR_7725_SAVED_VIEW_ASSIGNEE_FLAG } from '@/lib/flags/keys'
import { HTPR_7804_BLOCKED_BY_ME_FLAG } from '@/lib/flags/definitions/htpr-7804-blocked-by-me'

const useRenderedViews = (project: IProject | null) => {
  const blockedByMeListEnabled = useFlag(HTPR_8826_BLOCKED_BY_ME_LIST_FLAG)
  const blockedByMeEnabled = useFlag(HTPR_7804_BLOCKED_BY_ME_FLAG)
  const agentCreatorFilterEnabled = useFlag(HTPR_7865_AGENT_CREATOR_FILTER_FLAG)
  const assigneeFixEnabled = useFlag(HTPR_7725_SAVED_VIEW_ASSIGNEE_FLAG)
  const orderedViews = useOrderedViews(project)
  const hiddenViewTabIds = useRecoilValue(hiddenViewTabIdsAtom)
  const showEmptyViewTabs = useRecoilValue(showEmptyViewTabsAtom)
  const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom)
  const currentUser = useRecoilValue(currentUserAtom)
  const { timers: runningTimers } = useBoardRunningTimers(project?.id ?? null)
  const filterRuntimeContext = useMemo(() => ({
    legacyAgentAssigneeMatch: !assigneeFixEnabled,
    agentCreatorFilterEnabled,
    runningTaskIds: new Set(runningTimers.keys()),
  }), [agentCreatorFilterEnabled, assigneeFixEnabled, runningTimers])
  const defaultViewId = project?.project_view?.default_view_id
  const activeViewId = getActiveBoardViewId(project, activeBuiltinViews)

  const views: BoardView[] = useMemo(() => (
    orderedViews.filter((view) => (
      view.id === defaultViewId ||
      view.id === activeViewId ||
      !hiddenViewTabIds[viewTabPreferenceKey(project?.id, view.id)]
    ))
  ), [activeViewId, defaultViewId, hiddenViewTabIds, orderedViews, project?.id])

  const savedViewTaskCounts = useMemo(() => {
    if (!project) return [] as (readonly [string, number])[]
    const activeColumns = getActiveColumnsViewFromProject(project)
    return (orderedViews.filter((view) => !isBuiltinView(view)) as IView[]).map((view) => {
      const visibleColumns = view.id === activeViewId
        ? activeColumns
        : view.board_columns_view as ISection[] | undefined
      return [
        view.id,
        countTasksInSavedView(view, project, visibleColumns, filterRuntimeContext),
      ] as const
    })
  }, [activeViewId, filterRuntimeContext, orderedViews, project])

  const viewTaskCounts = useMemo(() => {
    const tasks = project?.tasks ?? []
    const builtinContext = buildBuiltinViewContext(project, currentUser?.id, undefined, currentUser?.displayName)
    return new Map<string, number>([
      ...savedViewTaskCounts,
      ...BUILTIN_VIEWS.map((view) => [
        view.id,
        blockedByMeListEnabled && project && view.id === BUILTIN_VIEW_IDS.blockedByMe
          ? getBlockedByMeSections(project, builtinContext).reduce((count, section) => count + section.items.length, 0)
          : tasks.filter((task) => view.predicate(task, builtinContext)).length,
      ] as const),
    ])
  }, [blockedByMeListEnabled, currentUser?.id, currentUser?.displayName, project, savedViewTaskCounts])

  const renderedViews: BoardView[] = useMemo(() => {
    if (showEmptyViewTabs) return views

    return views.filter((view) => {
      const count = viewTaskCounts.get(view.id) ?? 0
      return count > 0 || view.id === defaultViewId || view.id === activeViewId
    })
  }, [activeViewId, defaultViewId, showEmptyViewTabs, viewTaskCounts, views])

  const viewsWithBlockedByMe = useMemo(
    () => views.filter((view) => view.id === BUILTIN_VIEW_IDS.blockedByMe || renderedViews.includes(view)),
    [views, renderedViews],
  )
  const visibleViews = blockedByMeEnabled ? viewsWithBlockedByMe : renderedViews
  return { views, orderedViews, renderedViews: visibleViews, viewTaskCounts }
}

export default useRenderedViews
