// hooks/useBulkActions.ts
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

  // Update items ref when items change
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // Clear selection when items change (unless persistSelection is true)
  // useEffect(() => {
  //   if (!persistSelection) {
  //     setSelectedIds(new Set())
  //   }
  // }, [items, persistSelection])

  // Convert selectedIds Set to array and notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(Array.from(selectedIds))
  }, [selectedIds, onSelectionChange])

  // Toggle single item selection
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

  // Select all items
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(itemsRef.current.map(item => item.id)))
  }, [])

  // Clear selection
  const clearSelection = useCallback(() => {

    setTimeout(() => {
      setSelectedIds(new Set())
    }, 2);
  }, [])

  // Select single item (clear others)
  const selectSingle = useCallback((index: number) => {
    if (index >= 0 && index < itemsRef.current.length) {
      const item = itemsRef.current[index]
      setSelectedIds(new Set([item.id]))
    }
  }, [])

  // Check if item is selected
  const isSelected = useCallback((id: number) => {
    return selectedIds.has(id)
  }, [selectedIds])

  // Get selected items
  const getSelectedItems = useCallback((): T[] => {
    return itemsRef.current.filter(item => selectedIds.has(item.id))
  }, [selectedIds])

  // Execute bulk action
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

  // Keyboard event handler
  const handleKeyDown = useCallback((e: KeyboardEvent, currentFocusIndex?: number) => {
    if (returnIfModalOrInputActive()) return
    if (!enableKeyboardShortcuts || currentFocusIndex === undefined) return

    const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey)

    // Ctrl/Cmd + A: Select all
    if (cmdControl && e.keyCode === KeyCodes.A) {
      e.preventDefault()
      selectAll()
    }
    if (cmdControl && e.shiftKey && e.keyCode === KeyCodes.A) {
      e.preventDefault()
      selectAllFromAllTabs()
    }

    // X: Toggle selection of current item
    if (e.keyCode === KeyCodes.X && !e.shiftKey && !cmdControl) {
      // e.preventDefault()
      const currentItem = itemsRef.current[currentFocusIndex]
      if (currentItem) {
        toggleSelection(currentItem.id)

      }
      return { newFocusIndex: currentFocusIndex }

    }

    // Shift + Arrow/J/K: Range selection (Windows-style)
    if (e.shiftKey && [KeyCodes.J, KeyCodes.K, KeyCodes.ARROW_DOWN, KeyCodes.ARROW_UP].includes(e.keyCode as any)) {
      e.preventDefault()
      const from = currentFocusIndex

      // Determine the new focus index based on the key
      const maxIndex = itemsRef.current.length - 1;
      let newFocusIndex: number | null = null;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        if (from < maxIndex) {
          newFocusIndex = from + 1;
        } else {
          newFocusIndex = null; // Already at bottom
        }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        if (from > 0) {
          newFocusIndex = from - 1;
          // 
        } else {
          newFocusIndex = null; // Already at top
        }
      }

      // first check is current active or not
      const isCurrentItemActive = selectedIds.has(itemsRef.current[from].id);

      // if the current item is not active, we have to select it first and not move to the next item
      if (!isCurrentItemActive) {
        toggleSelection(itemsRef.current[from].id)
        newFocusIndex = currentFocusIndex // because we are not moving to the next item
      }
      else {
        if (newFocusIndex === null) return
        // since current one is active, we check status of next item
        const isNextItemActive = selectedIds.has(itemsRef.current[newFocusIndex].id);

        // if inactive, then that item gets added to the selection
        if (!isNextItemActive) {
          toggleSelection(itemsRef.current[newFocusIndex].id)
        }
        else {
          // if it was already active and our current item is also active, then we deactive the current one.
          toggleSelection(itemsRef.current[from].id)
        }
      }

      // Don't update anchor during shift selection
      return { newFocusIndex }
    }


    // Check for action shortcuts
    if (selectedIds.size > 0) {
      for (const action of actions) {
        if (action.keyboardShortcut && action.keyboardShortcut.length > 0) {
          // Check if this is a multi-key shortcut
          if (action.keyboardShortcut.length === 1) {
            // Single key shortcut
            if (action.keyboardShortcut[0] === e.keyCode) {
              e.preventDefault()
              executeBulkAction(action.key)
              return
            }
          } else {
            // Multi-key shortcut - check all keys are pressed
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



    // Escape: Clear selection
    if (e.key === 'Escape' && selectedIds.size > 0) {
      e.preventDefault()
      clearSelection()
    }
  }, [enableKeyboardShortcuts, isApple, selectedIds, selectAll, toggleSelection, actions, executeBulkAction, clearSelection])

  return {
    // State - selectedIds now returned as number array
    selectedIds: Array.from(selectedIds),
    selectedCount: selectedIds.size,
    isProcessing,

    // Selection methods
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected,
    getSelectedItems,
    selectSingle,

    // Action methods
    executeBulkAction,

    // Event handlers
    handleKeyDown,
  }
}