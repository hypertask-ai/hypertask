'use client'
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useRecoilValue } from '@/lib/state'
import { IProject } from '@/models/model'
import useKanbanViews from '@/hooks/Homepage/Views/useKanbanViews'
import useRenderedViews from '@/hooks/Homepage/Views/useRenderedViews'
import useViewOrderActions from '@/hooks/Homepage/Views/useViewOrderActions'
import { activeBuiltinViewsAtom } from '@/store'
import { MobileViewContext } from '@/lib/contexts/mobileContext'
import { cn } from '@/utils/undoActions/helperFuncs'
import { Settings2, ChevronLeft, ChevronRight, House, Lock, Sparkles } from "lucide-react";
import { ViewVisibility } from "@prisma/client";

import Tooltip from '@/components/Common/Tooltip'
import ManageViews from '@/components/Modals/ViewModals/ManageViewsModals'
import ViewsForBoard from '@/components/Modals/ViewModals/ViewsForBoardModal'
import { useKanbanModalStatesContext } from '@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext'
import { getActiveBoardViewId, isBuiltinView } from '@/lib/constants/builtinViews'
import { useGetAllProjectLabels } from '@/hooks/MultiPages/useGetAllProjectLabels'
import { getSmartSplitLabel } from '@/lib/smartSplits'
import { useBoardStartup } from '@/lib/contexts/boardStartupContext'

// Pills for fast switching between saved views without opening the "Manage
// Views" modal (G then V). The app-shell rail wraps across rows so every split
// remains visible. The legacy bar scrolls horizontally instead.
// Mirrors the view list + active-view logic of ViewsForBoardModal.
interface IProps {
  project: IProject
  forceShow?: boolean
  appShellRail?: boolean
}

const SCROLL_STEP_PX = 160

const ViewTabsBar: React.FC<IProps> = ({ project, forceShow = false, appShellRail = false }) => {
  const isMbl = useContext(MobileViewContext)
  const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom)
  const { saveMyViewOrder } = useViewOrderActions(project.id)
  const { showManageViewsModal, toggleManageViewsModal, showViewsModal, toggleViewsModal } = useKanbanModalStatesContext()
  const { switchViewHandler } = useKanbanViews(project)
  const { renderedViews, orderedViews, viewTaskCounts } = useRenderedViews(project)
  const { secondaryStartupEnabled } = useBoardStartup()
  const { data: projectLabels = [] } = useGetAllProjectLabels(
    project.id,
    undefined,
    { enabled: secondaryStartupEnabled },
  )
  const scrollerRef = useRef<HTMLDivElement>(null)
  const activePillRef = useRef<HTMLButtonElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [draggingViewId, setDraggingViewId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const defaultViewId = project.project_view?.default_view_id
  // A built-in selection lives only in client state. Saved/default ids remain
  // the persistence fallback and never receive a synthetic id.
  const activeViewId = getActiveBoardViewId(project, activeBuiltinViews)

  // Native HTML5 drag, not a dnd library: hello-pangea/dnd only reorders within
  // a single row, so it cannot move a wrapped rail pill to an earlier row.
  const moveView = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId || targetId === defaultViewId || sourceId === defaultViewId) return

    // Reorder ids across the COMPLETE ordered list, not the rendered pills, so
    // hidden / empty views keep their relative position.
    const order = orderedViews.map((view) => view.id)
    const sourceIndex = order.indexOf(sourceId)
    const targetIndex = order.indexOf(targetId)
    if (sourceIndex === -1 || targetIndex === -1) return

    const [moved] = order.splice(sourceIndex, 1)
    order.splice(targetIndex, 0, moved)
    void saveMyViewOrder(order)
  }, [defaultViewId, orderedViews, saveMyViewOrder])

  // Track whether the pill row overflows its viewport, to show/hide the
  // desktop edge-scroll arrows. Mobile relies on native touch scroll instead.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || isMbl || appShellRail) return
    const updateScrollState = () => {
      setCanScrollLeft(el.scrollLeft > 1)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }
    updateScrollState()
    el.addEventListener('scroll', updateScrollState)
    const resizeObserver = new ResizeObserver(updateScrollState)
    resizeObserver.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      resizeObserver.disconnect()
    }
  }, [appShellRail, isMbl, renderedViews])

  // A scrolling bar can leave the active pill parked off-screen after a load,
  // which reads as "no view is selected" (HTPR-5097). The wrapped rail already
  // keeps every pill visible, so it never needs horizontal repositioning.
  useEffect(() => {
    if (appShellRail) return
    const scroller = scrollerRef.current
    const pill = activePillRef.current
    if (!scroller || !pill) return
    const centred = pill.offsetLeft - (scroller.clientWidth - pill.clientWidth) / 2
    scroller.scrollTo({ left: Math.max(0, centred), behavior: 'auto' })
  }, [activeViewId, appShellRail, renderedViews.length])

  // A single-view board has nothing to switch between — unless the rail
  // layout forces the bar, where the lone default pill is the board title.
  if (renderedViews.length < 2 && !forceShow) return null

  const scrollBy = (delta: number) => scrollerRef.current?.scrollBy({ left: delta, behavior: 'smooth' })

  return (
    <div className={appShellRail
      ? 'pills-row relative flex w-full min-w-0 items-start'
      : 'pills-row relative w-[97%] mx-auto'}>
            {!appShellRail && canScrollLeft && (
              <button
                type="button"
                aria-label="Scroll view tabs left"
                onClick={() => scrollBy(-SCROLL_STEP_PX)}
                className="absolute left-0 top-0 bottom-0 z-10 flex items-center px-1 bg-gradient-to-r from-pageBackground via-pageBackground/90 to-transparent"
              >
                <ChevronLeft size={14} className="text-header-text"  strokeWidth={1.75}/>
              </button>
            )}
            <div
              ref={scrollerRef}
              id="view-tabs-bar"
              className={appShellRail
                ? 'flex min-w-0 flex-1 flex-wrap items-center gap-[9px]'
                : 'flex items-center gap-1 overflow-x-auto scrollbar-none'}
            >
              {renderedViews.map((view, index) => {
                const isDefault = view.id === defaultViewId
                const isActive = view.id === activeViewId
                const label = isDefault ? project.title : view.title
                const count = viewTaskCounts.get(view.id) ?? 0
                const canDrag = !isMbl && !isDefault
                const smartLabel = isBuiltinView(view) ? null : getSmartSplitLabel(view, projectLabels, orderedViews)
                return (
                      <button
                        key={view.id}
                        ref={isActive ? activePillRef : undefined}
                        type="button"
                        title={label}
                        draggable={canDrag}
                        onDragStart={(event) => {
                          setDraggingViewId(view.id)
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', view.id)
                        }}
                        onDragOver={(event) => {
                          if (isDefault || !draggingViewId || draggingViewId === view.id) return
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                          setDropTargetId(view.id)
                        }}
                        onDragLeave={() => setDropTargetId((current) => current === view.id ? null : current)}
                        onDrop={(event) => {
                          event.preventDefault()
                          const sourceId = draggingViewId ?? event.dataTransfer.getData('text/plain')
                          setDraggingViewId(null)
                          setDropTargetId(null)
                          if (sourceId) moveView(sourceId, view.id)
                        }}
                        onDragEnd={() => {
                          setDraggingViewId(null)
                          setDropTargetId(null)
                        }}
                        onClick={() => {
                          if (!isActive) switchViewHandler(view)
                        }}
                        className={cn(
                          draggingViewId === view.id && 'opacity-40',
                          dropTargetId === view.id && 'bg-hover-active rounded-sm',
                          appShellRail
                          ? cn(
                              '!cursor-default relative group flex h-8 max-w-full min-w-0 items-center justify-start gap-1 whitespace-nowrap pr-[15px] text-[14.5px] transition-opacity',
                              // Dim non-active views so the active one pops; the
                              // home board is marked by its house icon, not a backdrop.
                              isActive
                                ? 'text-white-black'
                                : 'text-text-light-gray opacity-90 hover:opacity-100'
                            )
                          : cn(
                              'flex items-center gap-1 whitespace-nowrap text-dense leading-none px-3 py-[7px] rounded-md transition-colors !cursor-default',
                              isActive
                                ? 'bg-containerBackground text-white-black font-semibold'
                                : 'text-header-text hover:bg-hover-active font-medium'
                            ))}
                      >
                        {appShellRail ? (
                          <div className="flex min-w-0 max-w-full items-baseline gap-1">
                            {isDefault && (
                              <House
                                size={13}
                                strokeWidth={1.75}
                                className="shrink-0 self-center"
                              />
                            )}
                            {smartLabel && (
                              <Sparkles
                                size={13}
                                strokeWidth={1.75}
                                className="shrink-0 self-center text-hypertasks-ai-purple"
                                aria-label="Smart split"
                              />
                            )}
                            <span className={cn('footer_tags min-w-0 max-w-[min(18rem,calc(100vw-8rem))] truncate', isActive && '!font-semibold')}>
                              {label}
                            </span>
                            <p className="font-normal footer_tags text-micro text-gray-600 dark:text-gray-300">
                              {count}
                            </p>
                            {!isBuiltinView(view) && view.visibility === ViewVisibility.Private && (
                              <Lock size={11} strokeWidth={1.75} className="self-center text-text-light-gray" />
                            )}
                            {/* Gear lives INSIDE the last pill so it can only wrap
                                together with a pill, never alone onto its own row. */}
                            {!isMbl && index === renderedViews.length - 1 && (
                              <span
                                role="button"
                                tabIndex={0}
                                aria-label="Manage views"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  toggleManageViewsModal()
                                }}
                                className="group relative flex shrink-0 items-center justify-center self-center px-1 text-text-light-gray pills-gear"
                              >
                                <Settings2 size={14} strokeWidth={1.75} />
                                <Tooltip text="Manage views" left={-35} bottom={-34} keyCombination={[]} />
                              </span>
                            )}
                          </div>
                        ) : (
                          <>
                            {isDefault && <House size={12}  strokeWidth={1.75}/>}
                            {smartLabel && (
                              <Sparkles
                                size={12}
                                strokeWidth={1.75}
                                className="shrink-0 text-hypertasks-ai-purple"
                                aria-label="Smart split"
                              />
                            )}
                            {label}
                          </>
                        )}
                      </button>
                )
              })}
            </div>
            {/* The legacy header owns its ManageViews instance. The rail has no
                ViewsHeaderKanban, so it owns the single instance here. */}
            {appShellRail && showManageViewsModal && <ManageViews toggle={toggleManageViewsModal} />}
            {/* g-then-v jump-to-view modal: the legacy header mounts its own; the rail shell mounts it here. */}
            {appShellRail && showViewsModal && <ViewsForBoard toggle={toggleViewsModal} project={project} />}
            {!appShellRail && canScrollRight && (
              <button
                type="button"
                aria-label="Scroll view tabs right"
                onClick={() => scrollBy(SCROLL_STEP_PX)}
                className="absolute right-0 top-0 bottom-0 z-10 flex items-center px-1 bg-gradient-to-l from-pageBackground via-pageBackground/90 to-transparent"
              >
                <ChevronRight size={14} className="text-header-text"  strokeWidth={1.75}/>
              </button>
            )}
    </div>
  )
}

export default ViewTabsBar
