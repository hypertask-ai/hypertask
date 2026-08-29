import { useMemo } from 'react'
import { useRecoilValue } from '@/lib/state'
import { IProject, ISection, IView } from '@/models/model'
import { IFilterSettings } from '@/models/Filters/model'
import { activeBuiltinViewsAtom, currentUserAtom, hiddenViewTabIdsAtom, showEmptyViewTabsAtom } from '@/store'
import { applyFilters, defaultFilterSettings } from '@/utils/helperFunctions/Views/FilterHelperFunctions'
import { applySubTaskSetting } from '@/utils/helperFunctions/Views/SubtaskHelperFunction'
import {
  BoardView,
  BUILTIN_VIEWS,
  buildBuiltinViewContext,
  getActiveBoardViewId,
  isBuiltinView,
  viewTabPreferenceKey,
} from '@/lib/constants/builtinViews'
import useOrderedViews from './useOrderedViews'
import { useBoardRunningTimers } from '@/hooks/Task Detail/useTimeTracking'
import { DEFAULT_SUBTASK_SETTING } from '@/models/Views/model'

// Single source of truth for which view pills are visible: ordered views minus
// 0-task views (unless the user opted to show them; default and active stay).
// ViewTabsBar renders this list and Tab-cycling walks the same list.
const useRenderedViews = (project: IProject | null) => {
  const orderedViews = useOrderedViews(project)
  const hiddenViewTabIds = useRecoilValue(hiddenViewTabIdsAtom)
  const showEmptyViewTabs = useRecoilValue(showEmptyViewTabsAtom)
  const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom)
  const currentUser = useRecoilValue(currentUserAtom)
  const { timers: runningTimers } = useBoardRunningTimers(project?.id ?? null)
  const filterRuntimeContext = useMemo(() => ({
    runningTaskIds: new Set(runningTimers.keys()),
  }), [runningTimers])
  const defaultViewId = project?.project_view?.default_view_id
  const activeViewId = getActiveBoardViewId(project, activeBuiltinViews)

  // orderedViews already carries the built-ins, in the user's own order.
  const views: BoardView[] = useMemo(() => (
    orderedViews.filter((view) => (
      view.id === defaultViewId ||
      view.id === activeViewId ||
      !hiddenViewTabIds[viewTabPreferenceKey(project?.id, view.id)]
    ))
  ), [activeViewId, defaultViewId, hiddenViewTabIds, orderedViews, project?.id])

  const savedViewTaskCounts = useMemo(() => {
    const tasks = project?.tasks ?? []
    return (orderedViews.filter((view) => !isBuiltinView(view)) as IView[]).map((view) => {
      const columns = (view.board_columns_view as ISection[] | undefined) ?? project?.section ?? []
      const sections = columns
        .filter((column) => column.visibility !== false)
        .map((column) => {
          const sectionId = column.id ?? column.sectionId
          return {
            ...column,
            sectionId,
            items: tasks.filter((task) => task.sectionId === sectionId),
          }
        })
      const filters = (view.board_filters as IFilterSettings | undefined) ?? defaultFilterSettings
      const filteredSections = applySubTaskSetting(
        applyFilters(
          sections,
          filters.addedFilters ?? [],
          filters.matchFilters,
          project ?? undefined,
          filterRuntimeContext,
        ),
        view.board_subtask_setting ?? DEFAULT_SUBTASK_SETTING
      )
      return [view.id, filteredSections.reduce((count, section) => count + (section.items?.length ?? 0), 0)] as const
    })
  }, [filterRuntimeContext, orderedViews, project])

  const viewTaskCounts = useMemo(() => {
    const tasks = project?.tasks ?? []
    const builtinContext = buildBuiltinViewContext(project, currentUser?.id)
    return new Map<string, number>([
      ...savedViewTaskCounts,
      ...BUILTIN_VIEWS.map((view) => [
        view.id,
        tasks.filter((task) => view.predicate(task, builtinContext)).length,
      ] as const),
    ])
  }, [currentUser?.id, project, savedViewTaskCounts])

  const renderedViews: BoardView[] = useMemo(() => {
    if (showEmptyViewTabs) return views

    return views.filter((view) => {
      const count = viewTaskCounts.get(view.id) ?? 0
      return count > 0 || view.id === defaultViewId || view.id === activeViewId
    })
  }, [activeViewId, defaultViewId, showEmptyViewTabs, viewTaskCounts, views])

  return { views, orderedViews, renderedViews, viewTaskCounts }
}

export default useRenderedViews
