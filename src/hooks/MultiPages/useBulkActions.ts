import { useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import { useDeviceContext } from '@/lib/contexts/deviceContext'
import { KeyCodes } from '@/lib/constants/keyboard-handler'
import { useBulkSelectionContext } from '@/lib/contexts/Inbox/BulkSelectionContext'
import { returnIfModalOrInputActive } from '@/utils/helperFunctions/helperFunctions'

export interface BulkActionItem {
  id: any
  [key: string]: any
}

export interface BulkAction<T> {
  key: string
  label: string
  icon?: ReactNode
  handler: (selectedItems: any[]) => Promise<void> | void
  keyboardShortcut?: number[]
  isDestructive?: boolean
}

interface UseBulkActionsProps<T extends BulkActionItem> {
  items: T[]
  actions: BulkAction<T>[]
  onSelectionChange?: (selectedIds: number[]) => void
  enableKeyboardShortcuts?: boolean
  persistSelection?: boolean
}

export function useBulkActions<T extends BulkActionItem>({
  items,
  actions,
  onSelectionChange,
  enableKeyboardShortcuts = true,
  persistSelection = true
}: UseBulkActionsProps<T>) {
  const { selectedIds, setSelectedIds, selectAllFromAllTabs } = useBulkSelectionContext()
  const [isProcessing, setIsProcessing] = useState(false)
  const isApple = useDeviceContext()
  const itemsRef = useRef(items)

  useEffect(() => {
    itemsRef.current = items
  }, [items])


  useEffect(() => {
    onSelectionChange?.(Array.from(selectedIds))
  }, [selectedIds, onSelectionChange])

  const toggleSelection = useCallback((id: number) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(itemsRef.current.map(item => item.id)))
  }, [])

  const clearSelection = useCallback(() => {

    setTimeout(() => {
      setSelectedIds(new Set())
    }, 2);
  }, [])

  const selectSingle = useCallback((index: number) => {
    if (index >= 0 && index < itemsRef.current.length) {
      const item = itemsRef.current[index]
      setSelectedIds(new Set([item.id]))
    }
  }, [])

  const isSelected = useCallback((id: number) => {
    return selectedIds.has(id)
  }, [selectedIds])

  const getSelectedItems = useCallback((): T[] => {
    return itemsRef.current.filter(item => selectedIds.has(item.id))
  }, [selectedIds])

  const executeBulkAction = useCallback(async (actionKey: string) => {
    const action = actions.find(a => a.key === actionKey)
    if (!action || selectedIds.size === 0 || isProcessing) return

    setIsProcessing(true)
    try {
      const selectedItems = getSelectedItems()
      await action.handler(selectedItems)
      if (!persistSelection) {
        clearSelection()
      }
    } catch (error) {
      console.error(`Bulk action ${actionKey} failed:`, error)
      throw error
    } finally {
      setIsProcessing(false)
    }
  }, [actions, selectedIds, getSelectedItems, clearSelection, persistSelection, isProcessing])

  const handleKeyDown = useCallback((e: KeyboardEvent, currentFocusIndex?: number) => {
    if (returnIfModalOrInputActive()) return
    if (!enableKeyboardShortcuts || currentFocusIndex === undefined) return

    const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey)

    if (cmdControl && e.keyCode === KeyCodes.A) {
      e.preventDefault()
      selectAll()
    }
    if (cmdControl && e.shiftKey && e.keyCode === KeyCodes.A) {
      e.preventDefault()
      selectAllFromAllTabs()
    }

    if (e.keyCode === KeyCodes.X && !e.shiftKey && !cmdControl) {
      const currentItem = itemsRef.current[currentFocusIndex]
      if (currentItem) {
        toggleSelection(currentItem.id)

      }
      return { newFocusIndex: currentFocusIndex }

    }

    if (e.shiftKey && [KeyCodes.J, KeyCodes.K, KeyCodes.ARROW_DOWN, KeyCodes.ARROW_UP].includes(e.keyCode as any)) {
      e.preventDefault()
      const from = currentFocusIndex

      const maxIndex = itemsRef.current.length - 1;
      let newFocusIndex: number | null = null;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        if (from < maxIndex) {
          newFocusIndex = from + 1;
        } else {
          newFocusIndex = null;
        }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        if (from > 0) {
          newFocusIndex = from - 1;
        } else {
          newFocusIndex = null;
        }
      }

      const isCurrentItemActive = selectedIds.has(itemsRef.current[from].id);

      if (!isCurrentItemActive) {
        toggleSelection(itemsRef.current[from].id)
        newFocusIndex = currentFocusIndex
      }
      else {
        if (newFocusIndex === null) return
        const isNextItemActive = selectedIds.has(itemsRef.current[newFocusIndex].id);

        if (!isNextItemActive) {
          toggleSelection(itemsRef.current[newFocusIndex].id)
        }
        else {
          toggleSelection(itemsRef.current[from].id)
        }
      }

      return { newFocusIndex }
    }


    if (selectedIds.size > 0) {
      for (const action of actions) {
        if (action.keyboardShortcut && action.keyboardShortcut.length > 0) {
          if (action.keyboardShortcut.length === 1) {
            if (action.keyboardShortcut[0] === e.keyCode) {
              e.preventDefault()
              executeBulkAction(action.key)
              return
            }
          } else {
            const isShortcutPressed = action.keyboardShortcut.every(keyCode => {
              switch (keyCode) {
                case KeyCodes.SHIFT:
                  return e.shiftKey
                case KeyCodes.CTRL:
                  return e.ctrlKey
                case KeyCodes.ALT:
                  return e.altKey
                case KeyCodes.META_LEFT:
                case KeyCodes.META_RIGHT:
                case KeyCodes.COMMAND:
                  return e.metaKey
                default:
                  return e.keyCode === keyCode
              }
            })

            if (isShortcutPressed) {
              e.preventDefault()
              executeBulkAction(action.key)
              return
            }
          }
        }
      }
    }

    if (e.key === 'Escape' && selectedIds.size > 0) {
      e.preventDefault()
      clearSelection()
    }
  }, [enableKeyboardShortcuts, isApple, selectedIds, selectAll, toggleSelection, actions, executeBulkAction, clearSelection])

  return {
    selectedIds: Array.from(selectedIds),
    selectedCount: selectedIds.size,
    isProcessing,

    toggleSelection,
    selectAll,
    clearSelection,
    isSelected,
    getSelectedItems,
    selectSingle,

    executeBulkAction,

    handleKeyDown,
  }
}