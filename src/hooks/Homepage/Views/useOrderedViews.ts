import { useEffect, useMemo } from 'react'
import { useRecoilValue } from '@/lib/state'
import { IProject } from '@/models/model'
import { optimisticViewTabsOrderAtom, viewTabsOrderAtom } from '@/store'
import { saveViewOrder } from '@/utils/api/viewOrder'
import { asViewOrder, sortViewsByOrder } from '@/utils/helperFunctions/Views/ViewOrderHelperFunctions'
import { BUILTIN_VIEWS, type BoardView } from '@/lib/constants/builtinViews'

const localOrderMigrations = new Set<number>()

// Saved views AND built-ins in one ordered list: built-ins are draggable and
// manageable like any other view, they just default to the end of the order.
const useOrderedViews = (project: IProject | null): BoardView[] => {
  const viewOrder = useRecoilValue(viewTabsOrderAtom)
  const optimisticViewOrder = useRecoilValue(optimisticViewTabsOrderAtom)
  const defaultViewId = project?.project_view?.default_view_id
  const unsavedViewId = project?.project_view?.user_project_views[0]?.unsavedView?.id
  const projectId = project?.id
  const userServerOrder = asViewOrder(project?.project_view?.user_project_views[0]?.view_order)
  const projectDefaultOrder = asViewOrder(project?.project_view?.default_view_order)
  const hasLocalOrder = projectId !== undefined && Object.prototype.hasOwnProperty.call(viewOrder, projectId)
  const localOrder = projectId !== undefined && hasLocalOrder ? viewOrder[projectId] : undefined
  const effectiveOrder = projectId === undefined
    ? undefined
    : optimisticViewOrder[projectId] ?? userServerOrder ?? projectDefaultOrder ?? localOrder

  // One-time migration path for the HTPR-4200 localStorage preference. Once a
  // server order/default exists this branch can never overwrite it.
  useEffect(() => {
    if (
      projectId === undefined ||
      userServerOrder !== undefined ||
      projectDefaultOrder !== undefined ||
      !hasLocalOrder ||
      !localOrder ||
      localOrderMigrations.has(projectId)
    ) return

    localOrderMigrations.add(projectId)
    void saveViewOrder(projectId, localOrder).catch(() => {
      localOrderMigrations.delete(projectId)
    })
  }, [hasLocalOrder, localOrder, projectDefaultOrder, projectId, userServerOrder])

  return useMemo(() => {
    const all = project?.project_view?.allViews ?? []
    // Drop the live "unsaved" pseudo-view; keep the default view first.
    const views: BoardView[] = [
      ...all.filter((view) => view.id !== unsavedViewId),
      ...BUILTIN_VIEWS,
    ]
    return sortViewsByOrder(views, effectiveOrder, defaultViewId)
  }, [project?.project_view?.allViews, defaultViewId, unsavedViewId, effectiveOrder])
}

export default useOrderedViews
