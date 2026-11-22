import { useContext, useEffect, useRef } from 'react'
import { useRecoilValue } from '@/lib/state'
import { IProject } from '@/models/model'
import { activeBuiltinViewsAtom, appShellRailAtom, hiddenViewTabIdsAtom, showBoardManagerAtom, showCommandsAtom } from '@/store'
import { returnIfModalOrInputActive } from '@/utils/helperFunctions/helperFunctions'
import useKanbanViews from './useKanbanViews'
import useRenderedViews from './useRenderedViews'
import { MobileViewContext } from '@/lib/contexts/mobileContext'
import { getActiveBoardViewId, getHiddenOpenViewToLeave } from '@/lib/constants/builtinViews'
import { useFlag } from '@/hooks/useFlag'
import { HTPR_9362_HIDE_ACTIVE_VIEW_FLAG } from '@/lib/flags/definitions/htpr-9362-hide-active-view'

const useViewCyclingShortcuts = (project: IProject | null) => {
  const hideOpenView = useFlag(HTPR_9362_HIDE_ACTIVE_VIEW_FLAG)
  const { renderedViews: views, orderedViews } = useRenderedViews(project)
  const { switchViewHandler } = useKanbanViews(project)
  const showBoardManager = useRecoilValue(showBoardManagerAtom)
  const showCommands = useRecoilValue(showCommandsAtom)
  const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom)
  const hiddenViewTabIds = useRecoilValue(hiddenViewTabIdsAtom)
  const isMbl = useContext(MobileViewContext)
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl
  const leavingHiddenView = useRef<string | null>(null)
  const viewToLeaveTo = hideOpenView
    ? getHiddenOpenViewToLeave(project, activeBuiltinViews, orderedViews, hiddenViewTabIds)
    : undefined

  useEffect(hideOpenView ? () => {
    if (!project || !viewToLeaveTo) {
      leavingHiddenView.current = null
      return
    }
    const activeViewId = getActiveBoardViewId(project, activeBuiltinViews)
    const leaveKey = activeViewId ? `${project.id}:${activeViewId}` : null
    if (!leaveKey || leavingHiddenView.current === leaveKey) return
    leavingHiddenView.current = leaveKey
    void Promise.resolve(switchViewHandler(viewToLeaveTo)).catch(() => {
      if (leavingHiddenView.current === leaveKey) leavingHiddenView.current = null
    })
  } : () => {}, [activeBuiltinViews, hideOpenView, project, switchViewHandler, viewToLeaveTo])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isViewCycleKey = appShellRailOn
        ? event.key === 'Tab'
        : event.key === '[' || event.key === ']'
      if (!isViewCycleKey) return

      const target = event.target
      const isTypingTarget = target instanceof HTMLElement && (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
      )
      if (
        !project ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (!appShellRailOn && event.shiftKey) ||
        isTypingTarget ||
        showBoardManager ||
        showCommands.show ||
        returnIfModalOrInputActive() ||
        views.length < 2
      ) return

      const activeViewId = getActiveBoardViewId(project, activeBuiltinViews)
      const activeIndex = views.findIndex((view) => view.id === activeViewId)
      if (activeIndex === -1) return

      event.preventDefault()
      const direction = appShellRailOn ? (event.shiftKey ? -1 : 1) : (event.key === ']' ? 1 : -1)
      const nextIndex = (activeIndex + direction + views.length) % views.length
      switchViewHandler(views[nextIndex])
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeBuiltinViews, appShellRailOn, project, showBoardManager, showCommands.show, switchViewHandler, views])
}

export default useViewCyclingShortcuts
