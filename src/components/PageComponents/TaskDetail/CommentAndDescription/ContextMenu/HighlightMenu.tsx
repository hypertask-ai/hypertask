import { useEffect, useRef, useState, CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  useFloating,
  autoUpdate,
  offset as middlewareOffset,
  arrow as middlewareArrow,
  useDismiss,
  useRole,
  useClick,
  useInteractions,
  FloatingFocusManager,
  useId,
  FloatingArrow,
  Placement,
} from "@floating-ui/react";
import { useGetSelectionDetails, getPopoverCoordinates, setClipboard } from ".";

import { MenuArgs, SetMenuOpen, TargetSelector } from "./types";

const ARROW_WIDTH = 10;
const ARROW_HEIGHT = 5;

const getMenuStyles = (styles: CSSProperties = {}) => {
  const defaultStyles: CSSProperties = {
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "#CCC",
    borderRadius: 5,
    margin: 0,
    display: "flex",
    gap: 5,
    ...styles,
  };

  defaultStyles.margin = -(defaultStyles.borderWidth ?? 0);
  return defaultStyles;
};

type MainArgs = {
  target: TargetSelector;
  menu: (props: MenuArgs) => React.ReactNode;
  styles?: CSSProperties;
  offset?: number;
  allowedPlacements: Array<Placement>;
  zIndex?: number;
};

function HighlightMenu({
  target,
  menu,
  offset = 2, // This offset now determines the gap between the menu and the top of the highlight
  styles,
  allowedPlacements,
  zIndex = 999999999,
  ...props
}: MainArgs) {
  const selection = useGetSelectionDetails(target);
  const [menuOpen, setMenuOpen] = useState<SetMenuOpen>(null);
  const clientRect = getPopoverCoordinates(selection?.range);

  const arrowRef = useRef(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const menuStyles = getMenuStyles(styles);
  const borderWidth = menuStyles.borderWidth as number;

  const { refs, floatingStyles, context } = useFloating({
    open: !!menuOpen,
    strategy: "fixed",
    placement: "top", // Keep "top" so the arrow points down from the menu
    middleware: [
      // This middlewareOffset value determines how far the floating element is placed from the reference.
      // A positive offset for "top" placement moves it *away* from the reference (i.e., further up).
      // A negative offset would move it *closer* to the reference (i.e., further down, possibly overlapping).
      // We are primarily controlling 'top' via getFloatingStylesOverride, but this still impacts arrow positioning relative to the menu.
      middlewareOffset(offset + ARROW_HEIGHT + borderWidth),
      middlewareArrow({
        element: arrowRef,
        padding: ARROW_WIDTH / 2,
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (menuRef.current) {
      refs.setFloating(menuRef.current);
    }
  }, [menuRef, refs.setFloating]);

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);

  const headingId = useId();

  useEffect(() => {
    setMenuOpen(clientRect);
  }, [JSON.stringify(clientRect)]);

  const getFloatingStylesOverride = () => {
    if (!clientRect) return floatingStyles;
    const top = clientRect.top - (menuRef.current?.offsetHeight || 0) - offset;
    const left =
      clientRect.left +
      clientRect.width / 2 -
      (menuRef.current?.offsetWidth || 0) / 2;

    return {
      position: "fixed" as const,
      top: top,
      left: left,
      zIndex,
      ...(getFloatingProps().style || {}),
    };
  };

  const menuContent = menuOpen && selection && (
    <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
      <div
        className="Popover"
        ref={refs.setFloating}
        style={getFloatingStylesOverride()}
        aria-labelledby={headingId}
        {...getFloatingProps()}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onMouseUp={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <div {...props} style={menuStyles} ref={menuRef}>
          {menu({ ...selection, setMenuOpen, setClipboard })}
        </div>
        <FloatingArrow
          ref={arrowRef}
          context={context}
          width={ARROW_WIDTH}
          height={ARROW_HEIGHT}
          stroke={menuStyles.borderColor}
          fill={menuStyles.backgroundColor}
          strokeWidth={borderWidth}
        />
      </div>
    </FloatingFocusManager>
  );

  return (
    <>
      <div
        ref={refs.setReference}
        {...getReferenceProps()}
        style={{
          ...(clientRect
            ? {
                top: clientRect.top,
                left: clientRect.left,
                width: clientRect.width,
                height: clientRect.height,
              }
            : {}),
          position: "fixed",
          userSelect: "none",
          pointerEvents: "none",
        }}
      />
      {typeof document !== "undefined" &&
        menuContent &&
        createPortal(menuContent, document.body)}
    </>
  );
}

export default HighlightMenu;
