"use client";

import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  children: ReactNode | ((rect: DOMRect) => ReactNode);
  hover?: boolean;
  groupHoverId?: string;
  anchorElement?: Element | null;
  anchorRect?: DOMRect | null;
  placement?: "inline" | "below" | "fixed";
  adjustToViewport?: boolean;
  interactive?: boolean;
}

const TooltipPortal = ({
  children,
  hover = false,
  groupHoverId = "",
  anchorElement = null,
  anchorRect = null,
  placement = "inline",
  adjustToViewport = true,
  interactive = false,
}: Props) => {
  const portalAnchorRef = useRef<HTMLSpanElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Element | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(anchorRect);
  const [open, setOpen] = useState(!hover || !!anchorElement || !!anchorRect);

  useLayoutEffect(() => {
    const parent = anchorElement ?? portalAnchorRef.current?.parentElement;
    if (!parent) return;
    setAnchor(parent);
    if (!hover || anchorElement || anchorRect) {
      setOpen(true);
      return;
    }

    const groupClass = `group${groupHoverId}`;
    let trigger: Element | null = parent;
    if (placement === "inline") {
      while (trigger && !trigger.classList.contains(groupClass)) trigger = trigger.parentElement;
    }
    trigger ??= parent;
    const show = () => setOpen(true);
    const hide = () => setOpen(false);
    setOpen(trigger.matches(":hover"));
    trigger.addEventListener("mouseenter", show);
    trigger.addEventListener("mouseleave", hide);
    if (placement === "below") {
      trigger.addEventListener("focusin", show);
      trigger.addEventListener("focusout", hide);
    }
    return () => {
      trigger.removeEventListener("mouseenter", show);
      trigger.removeEventListener("mouseleave", hide);
      trigger.removeEventListener("focusin", show);
      trigger.removeEventListener("focusout", hide);
    };
  }, [anchorElement, anchorRect, groupHoverId, hover, placement]);

  useLayoutEffect(() => {
    if (!open || (!anchor && !anchorRect && placement !== "fixed")) return;
    const updatePosition = () => {
      const containingBlock = placement === "inline"
        ? (portalAnchorRef.current?.offsetParent as Element | null) ?? anchor
        : anchor;
      const nextRect = anchorRect ?? containingBlock?.getBoundingClientRect() ?? new window.DOMRect();
      setRect(nextRect);
      const portal = portalRef.current;
      if (!portal) return;
      // A body portal alone still loses to showModal(), regardless of z-index.
      portal.showPopover?.();
      let left = placement === "fixed" ? 0 : nextRect.left;
      let top = placement === "below" ? nextRect.bottom + 8 : placement === "fixed" ? 0 : nextRect.top;
      portal.style.left = `${left}px`;
      portal.style.top = `${top}px`;
      portal.style.width = `${placement === "inline" ? nextRect.width : 0}px`;
      portal.style.height = `${placement === "inline" ? nextRect.height : 0}px`;
      if (!adjustToViewport || placement === "fixed") return;
      const tooltipRect = portal.firstElementChild?.getBoundingClientRect();
      if (!tooltipRect) return;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      left += Math.max(8, Math.min(tooltipRect.left, viewportWidth - tooltipRect.width - 8)) - tooltipRect.left;
      if (placement === "below" && tooltipRect.bottom > viewportHeight) {
        top = nextRect.top - tooltipRect.height - 8;
      }
      const tooltipTop = top + tooltipRect.top - parseFloat(portal.style.top);
      top += Math.max(0, Math.min(tooltipTop, viewportHeight - tooltipRect.height)) - tooltipTop;
      portal.style.left = `${left}px`;
      portal.style.top = `${top}px`;
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    const observer = window.ResizeObserver ? new window.ResizeObserver(updatePosition) : null;
    if (anchor) observer?.observe(anchor);
    if (portalRef.current?.firstElementChild) observer?.observe(portalRef.current.firstElementChild);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      observer?.disconnect();
    };
  }, [anchor, anchorRect, open, placement, adjustToViewport, !!rect]);

  useLayoutEffect(() => {
    const portal = portalRef.current;
    if (!portal || !open || !portal.showPopover) return;
    // Top-layer order, not z-index, decides which native dialog/popover wins.
    const raise = () => {
      if (!portal.matches(":popover-open")) return;
      portal.hidePopover();
      portal.showPopover();
    };
    const onToggle = (event: Event) => {
      const target = event.target;
      if (target instanceof window.Element && !target.hasAttribute("data-hover-tooltip-portal") && target.matches(":popover-open")) raise();
    };
    const observer = new window.MutationObserver((records) => {
      if (records.some(({ target }) => target instanceof window.Element && target.matches("dialog[open]"))) raise();
    });
    document.addEventListener("toggle", onToggle, true);
    observer.observe(document.body, { attributes: true, attributeFilter: ["open"], subtree: true });
    return () => {
      document.removeEventListener("toggle", onToggle, true);
      observer.disconnect();
    };
  }, [open, !!rect]);

  return <>
    <span ref={portalAnchorRef} aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }} />
    {open && rect && typeof document !== "undefined" && createPortal(
      <div ref={portalRef} popover="manual" data-hover-tooltip-portal data-interactive={interactive || undefined}>
        {typeof children === "function" ? children(rect) : children}
      </div>,
      anchor?.closest("dialog[open]") ?? document.body,
    )}
  </>;
};

export default TooltipPortal;
