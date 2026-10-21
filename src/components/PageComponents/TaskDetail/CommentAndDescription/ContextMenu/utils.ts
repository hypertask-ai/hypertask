import {
    SetClipboard,
    HMClientRect,
    TargetSelector,
    TargetElements,
    SelectionDetails,
  } from "./types";
  
  const getPopoverCoordinates = (
    range: Range | undefined
  ): HMClientRect | null => {
      if (!range) return null;
    const { top, left, width, height } = range?.getBoundingClientRect() ?? {};
    return {
      top,
      left,
      width,
      height,
    };
  };
  
  const setClipboard: SetClipboard = (text, onSuccess, onError) => {
    if (!navigator?.clipboard) return false;
    if (!text) return false;
    return navigator.clipboard
      .writeText(text)
      .then(() => {
        if (onSuccess) onSuccess();
        return true;
      })
      .catch((error) => {
        if (onError) onError(error);
        return false;
      });
  };
  
  function resolveTargets(target: TargetSelector): TargetElements {
    if (typeof target === "string") {
      return document.querySelectorAll(target);
    } else {
      return [target?.current].filter(Boolean);
    }
  }
  
  function getSelectionDetails(): SelectionDetails {
    return getDomSelectionDetails() || getUISelection();
  }
  
  function getUISelection(): SelectionDetails {
    const focusedElement = document?.activeElement as HTMLInputElement;
  
    const selectedText = focusedElement?.value?.substring?.(
      focusedElement?.selectionStart || 0,
      focusedElement?.selectionEnd || 0
    );
  
    const selectionDetails: SelectionDetails = {
      baseNode: focusedElement,
      extentNode: focusedElement,
      range: focusedElement as unknown as Range,
      selectedText,
    };
  
    return selectedText ? selectionDetails : null;
  }
  
  function getDomSelectionDetails(): SelectionDetails {
    if (window?.getSelection?.()?.isCollapsed) return null;
    const Serializer = new XMLSerializer();
    const selection = window?.getSelection();
    const range = selection?.getRangeAt(0);
    const selectedNode = range?.cloneContents() as Node;
    const selectedHtml = Serializer.serializeToString(selectedNode);
    const selectedText = selection?.toString();
    const selectionDetails: SelectionDetails = {
      baseNode: selection?.anchorNode,
      extentNode: selection?.focusNode,
      range,
      selectedHtml,
      selectedText,
    };
    return selectionDetails;
  }
  
  function isSelectionWithinTarget(
    targets: TargetElements,
    selection: SelectionDetails
  ): boolean {
    if (!targets?.length) return false;
    return Array.from(targets)?.some((t) =>
      selection?.baseNode ? t?.contains(selection.baseNode) : false
    );
  }
  
  export {
    setClipboard,
    getPopoverCoordinates,
    getSelectionDetails,
    getUISelection,
    getDomSelectionDetails,
    isSelectionWithinTarget,
    resolveTargets,
  };