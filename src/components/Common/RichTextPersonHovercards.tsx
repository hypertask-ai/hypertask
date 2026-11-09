"use client";

import { PERSON_HOVERCARD_OPEN_DELAY_MS, PersonHovercardSurface } from "@/components/Common/PersonHovercard";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7873_NAME_HOVERCARD_DELAY_FLAG } from "@/lib/flags/definitions/htpr-7873-name-hovercard-delay";
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
  const openTimerRef = useRef<number | null>(null);
  const pendingElementRef = useRef<HTMLElement | null>(null);
  const delayedOpen = useFlag(HTPR_7873_NAME_HOVERCARD_DELAY_FLAG);
  const [active, setActive] = useState<{
    element: HTMLElement;
    subject: PersonHovercardSubject;
  } | null>(null);
  const [open, setOpen] = useState(false);

  const cancelClose = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const cancelOpen = () => {
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
    pendingElementRef.current = null;
  };
  const scheduleClose = () => {
    cancelOpen();
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 90);
  };
  const activate = (target: EventTarget | null, openDelay: number) => {
    const mention = mentionFromTarget(target);
    if (!mention) return;
    cancelClose();
    if (!openDelay) {
      setActive(mention);
      setOpen(true);
      return;
    }
    if (pendingElementRef.current === mention.element) return;
    cancelOpen();
    pendingElementRef.current = mention.element;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      pendingElementRef.current = null;
      setActive(mention);
      setOpen(true);
    }, openDelay);
  };

  const bindRoot = (openDelay: number) => {
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

    const fromMouse = (event: PointerEvent | MouseEvent) => (event as PointerEvent).pointerType === "mouse";
    const onPointerOver = (event: PointerEvent) => {
      if (!fromMouse(event)) return;
      activate(event.target, openDelay);
    };
    const onPointerOut = (event: PointerEvent) => {
      if (!fromMouse(event)) return;
      const mention = mentionFromTarget(event.target);
      const next = event.relatedTarget;
      if (mention && (!(next instanceof Node) || !mention.element.contains(next))) {
        scheduleClose();
      }
    };
    const onTap = (event: MouseEvent) => {
      if (fromMouse(event)) return;
      const mention = mentionFromTarget(event.target);
      if (!mention) return;
      cancelClose();
      setActive(mention);
      setOpen(true);
    };
    const onFocusIn = (event: FocusEvent) => {
      const mention = mentionFromTarget(event.target);
      if (!mention || !mention.element.matches(":focus-visible")) return;
      activate(event.target, openDelay);
    };
    const onFocusOut = (event: FocusEvent) => {
      const mention = mentionFromTarget(event.target);
      const next = event.relatedTarget;
      if (mention && (!(next instanceof Node) || !mention.element.contains(next))) {
        scheduleClose();
      }
    };

    root.addEventListener("pointerover", onPointerOver);
    root.addEventListener("pointerout", onPointerOut);
    root.addEventListener("click", onTap);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      observer.disconnect();
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerout", onPointerOut);
      root.removeEventListener("click", onTap);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    };
  };

  useEffect(
    delayedOpen ? () => bindRoot(PERSON_HOVERCARD_OPEN_DELAY_MS) : () => bindRoot(0),
    [children, projectId, delayedOpen],
  );

  useEffect(() => () => {
    cancelClose();
    cancelOpen();
  }, []);

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
