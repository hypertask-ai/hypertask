"use client";

import { PersonHovercardSurface } from "@/components/Common/PersonHovercard";
import type { PersonHovercardSubject } from "@/models/personHovercard";
import { ReactNode, useEffect, useRef, useState } from "react";

export const parsePersonMention = (
  value: string | null,
): PersonHovercardSubject | null => {
  const user = value?.match(/^name-([1-9]\d*)$/);
  if (user) return { kind: "user", id: Number(user[1]) };

  const agent = value?.match(
    /^agent-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  if (agent) return { kind: "agent", id: agent[1] };

  return null;
};

const mentionFromTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>(".mention[data-label]");
  if (!element) return null;
  const subject = parsePersonMention(element.getAttribute("data-label"));
  return subject ? { element, subject } : null;
};

const RichTextPersonHovercards = ({
  projectId,
  children,
}: {
  projectId?: number;
  children?: ReactNode;
}) => {
  const rootRef = useRef<HTMLElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [active, setActive] = useState<{
    element: HTMLElement;
    subject: PersonHovercardSubject;
  } | null>(null);
  const [open, setOpen] = useState(false);

  const cancelClose = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 90);
  };
  const activate = (target: EventTarget | null) => {
    const mention = mentionFromTarget(target);
    if (!mention) return;
    cancelClose();
    setActive(mention);
    setOpen(true);
  };

  useEffect(() => {
    const root = children ? rootRef.current : rootRef.current?.parentElement;
    if (!root) return;

    const prepareMentions = () => {
      root.querySelectorAll<HTMLElement>(".mention[data-label]").forEach((mention) => {
        const parsed = parsePersonMention(mention.getAttribute("data-label"));
        if (parsed) {
          mention.tabIndex = 0;
          mention.setAttribute("aria-haspopup", "dialog");
        } else {
          mention.removeAttribute("tabindex");
          mention.removeAttribute("aria-haspopup");
        }
      });
      setActive((current) => {
        if (!current) return current;
        const nextSubject = parsePersonMention(
          current.element.getAttribute("data-label"),
        );
        const identityChanged =
          !nextSubject ||
          nextSubject.kind !== current.subject.kind ||
          nextSubject.id !== current.subject.id;
        if (
          !current.element.isConnected ||
          !root.contains(current.element) ||
          identityChanged
        ) {
          setOpen(false);
          return null;
        }
        return current;
      });
    };
    prepareMentions();
    const observer = new MutationObserver(prepareMentions);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-label"],
    });

    const onPointerOver = (event: PointerEvent) => activate(event.target);
    const onPointerOut = (event: PointerEvent) => {
      const mention = mentionFromTarget(event.target);
      const next = event.relatedTarget;
      if (mention && (!(next instanceof Node) || !mention.element.contains(next))) {
        scheduleClose();
      }
    };
    const onFocusIn = (event: FocusEvent) => activate(event.target);
    const onFocusOut = (event: FocusEvent) => {
      const mention = mentionFromTarget(event.target);
      const next = event.relatedTarget;
      if (mention && (!(next instanceof Node) || !mention.element.contains(next))) {
        scheduleClose();
      }
    };

    root.addEventListener("pointerover", onPointerOver);
    root.addEventListener("pointerout", onPointerOut);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      observer.disconnect();
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerout", onPointerOut);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    };
  }, [children, projectId]);

  useEffect(() => () => cancelClose(), []);

  if (!projectId) return children ?? null;

  return (
    <>
      {children ? (
        <div ref={rootRef as React.RefObject<HTMLDivElement>} className="contents">
          {children}
        </div>
      ) : (
        <span ref={rootRef as React.RefObject<HTMLSpanElement>} hidden />
      )}
      {active && (
        <PersonHovercardSurface
          projectId={projectId}
          subject={active.subject}
          anchor={active.element}
          externallyOpen={open}
          onExternallyOpenChange={setOpen}
          onFloatingPointerEnter={cancelClose}
          onFloatingPointerLeave={scheduleClose}
          onFloatingFocusEnter={cancelClose}
          onFloatingFocusLeave={scheduleClose}
        />
      )}
    </>
  );
};

export default RichTextPersonHovercards;
