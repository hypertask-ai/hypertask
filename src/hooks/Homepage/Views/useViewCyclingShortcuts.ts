import { useContext, useEffect } from 'react'
import { useRecoilValue } from '@/lib/state'
import { IProject } from '@/models/model'
import { activeBuiltinViewsAtom, appShellRailAtom, showBoardManagerAtom, showCommandsAtom } from '@/store'
import { returnIfModalOrInputActive } from '@/utils/helperFunctions/helperFunctions'
import useKanbanViews from './useKanbanViews'
import useRenderedViews from './useRenderedViews'
import { MobileViewContext } from '@/lib/contexts/mobileContext'
import { getActiveBoardViewId } from '@/lib/constants/builtinViews'

const useViewCyclingShortcuts = (project: IProject | null) => {
  const { renderedViews: views } = useRenderedViews(project)
  const { switchViewHandler } = useKanbanViews(project)
  const showBoardManager = useRecoilValue(showBoardManagerAtom)
  const showCommands = useRecoilValue(showCommandsAtom)
  const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom)
  const isMbl = useContext(MobileViewContext)
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl

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
