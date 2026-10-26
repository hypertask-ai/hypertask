import { useEffect, useMemo } from 'react'
import { useRecoilValue, useSetRecoilState } from '@/lib/state'
import { IProject } from '@/models/model'
import { activeBuiltinViewsAtom, boardLayoutAtom, boardLayoutPreferenceAtom, optimisticViewTabsOrderAtom, viewTabsOrderAtom } from '@/store'
import { saveViewOrder } from '@/utils/api/viewOrder'
import { asViewOrder, sortViewsByOrder } from '@/utils/helperFunctions/Views/ViewOrderHelperFunctions'
import { BUILTIN_VIEWS, BUILTIN_VIEW_IDS, buildBuiltinViewContext, type BoardView } from '@/lib/constants/builtinViews'
import { useRouter } from 'next/navigation'
import { getActiveBoardLayoutPreferenceFromProject, replaceProjectSurface, savedBoardLayoutToClient } from '@/utils/helperFunctions/Views/ViewsHelperFunctions'
import { useFlag, useFlagLoaded } from '@/hooks/useFlag'
import { HTPR_7092_DECISIONS_FLAG, HTPR_7804_BLOCKED_BY_ME_FLAG } from '@/lib/flags/keys'

const localOrderMigrations = new Set<number>()

const useOrderedViews = (project: IProject | null): BoardView[] => {
  const blockedByMeEnabled = useFlag(HTPR_7804_BLOCKED_BY_ME_FLAG)
  const blockedByMeLoaded = useFlagLoaded(HTPR_7804_BLOCKED_BY_ME_FLAG)
  const setActiveBuiltinViews = useSetRecoilState(activeBuiltinViewsAtom)
  const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom)
  const setBoardLayout = useSetRecoilState(boardLayoutAtom)
  const boardLayoutPreference = useRecoilValue(boardLayoutPreferenceAtom)
  const router = useRouter()
  const decisionsEnabled = useFlag(HTPR_7092_DECISIONS_FLAG)
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

  useEffect(() => {
    if (!blockedByMeLoaded || blockedByMeEnabled || !project || activeBuiltinViews[project.id] !== BUILTIN_VIEW_IDS.blockedByMe) return
    setActiveBuiltinViews((active) => {
      if (active[project.id] !== BUILTIN_VIEW_IDS.blockedByMe) return active
      const next = { ...active }
      delete next[project.id]
      return next
    })
    setBoardLayout(savedBoardLayoutToClient(getActiveBoardLayoutPreferenceFromProject(project)) ?? boardLayoutPreference)
    replaceProjectSurface({
      currentHref: window.location.href,
      surface: null,
      replace: (destination, options) => router.replace(destination, options),
    })
  }, [activeBuiltinViews, blockedByMeEnabled, blockedByMeLoaded, boardLayoutPreference, project, router, setActiveBuiltinViews, setBoardLayout])

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

  const availableViews = useMemo(() => {
    const all = project?.project_view?.allViews ?? []
    const context = buildBuiltinViewContext(project)
    const views: BoardView[] = [
      ...all.filter((view) => view.id !== unsavedViewId),
      ...BUILTIN_VIEWS.filter((view) => !view.available || view.available(context)),
    ]
    return sortViewsByOrder(views, effectiveOrder, defaultViewId)
  }, [project, defaultViewId, unsavedViewId, effectiveOrder])
  const allViews = blockedByMeEnabled
    ? availableViews
    : availableViews.filter((view) => view.id !== BUILTIN_VIEW_IDS.blockedByMe)
  const viewsWithoutDecisions = useMemo(
    () => allViews.filter((view) => view.id !== BUILTIN_VIEW_IDS.decisions),
    [allViews],
  )
  return decisionsEnabled ? allViews : viewsWithoutDecisions
}

export default useOrderedViews
