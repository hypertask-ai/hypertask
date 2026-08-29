"use client";

import UserAvatar from "@/components/Common/UserAvatar";
import { usePersonHovercard } from "@/hooks/MultiPages/usePersonHovercard";
import type { PersonHovercardSubject } from "@/models/personHovercard";
import { agentPageHref } from "@/lib/agents/pageHref";
import Link from "next/link";
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { Check, Copy } from "lucide-react";
import {
  cloneElement,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type PersonHovercardProps = {
  projectId?: number;
  subject?: PersonHovercardSubject | null;
  children: ReactElement<any>;
};

type PersonHovercardSurfaceProps = {
  projectId?: number;
  subject?: PersonHovercardSubject | null;
  anchor?: HTMLElement | null;
  children?: ReactElement<any>;
  externallyOpen?: boolean;
  onExternallyOpenChange?: (open: boolean) => void;
  onFloatingPointerEnter?: () => void;
  onFloatingPointerLeave?: () => void;
  onFloatingFocusEnter?: () => void;
  onFloatingFocusLeave?: () => void;
};

const PersonHovercardSurface = ({
  projectId,
  subject,
  anchor,
  children,
  externallyOpen,
  onExternallyOpenChange,
  onFloatingPointerEnter,
  onFloatingPointerLeave,
  onFloatingFocusEnter,
  onFloatingFocusLeave,
}: PersonHovercardSurfaceProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const controlled = externallyOpen !== undefined;
  const open = controlled ? externallyOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (controlled) onExternallyOpenChange?.(next);
    else setInternalOpen(next);
    if (!next) setCopied(false);
  };

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    strategy: "fixed",
    placement: "bottom-start",
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (anchor) refs.setReference(anchor);
  }, [anchor, refs]);

  const hover = useHover(context, {
    mouseOnly: true,
    handleClose: safePolygon({ blockPointerEvents: true }),
  });
  const focus = useFocus(context, { enabled: !controlled });
  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: true });
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);

  const query = usePersonHovercard(projectId, subject ?? null, open);
  const profile = query.isFetching || query.isError ? undefined : query.data;
  const profileHref = profile ? agentPageHref(profile) : null;
  const email = profile?.kind === "user" ? profile.email : undefined;
  const headingId = useId();

  const copyEmail = async () => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  let reference: ReactNode = null;
  if (children) {
    const child = children as ReactElement<any>;
    reference = cloneElement(
      child,
      getReferenceProps({
        ref: refs.setReference,
        tabIndex: child.props.tabIndex ?? 0,
        "aria-expanded": open,
        "aria-haspopup": "dialog",
      }) as Record<string, unknown>,
    );
  }

  return (
    <>
      {reference}
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
            <section
              ref={refs.setFloating}
              style={floatingStyles}
              aria-labelledby={profile ? headingId : undefined}
              aria-label={profile ? undefined : "Person contact details"}
              className="relative z-[999999999] w-[272px] rounded-[4px] border-thin border-border-light-gray-thin bg-modalBackground p-3 text-white-black shadow-[0_12px_36px_rgba(0,0,0,0.28)]"
              {...getFloatingProps({
                onPointerEnter: onFloatingPointerEnter,
                onPointerLeave: onFloatingPointerLeave,
                onFocus: onFloatingFocusEnter,
                onBlur: onFloatingFocusLeave,
              })}
            >
              {profileHref && profile && (
                <Link
                  href={profileHref}
                  aria-label={`Open ${profile.displayName} agent page`}
                  className="absolute inset-0 z-10 cursor-pointer rounded-[3px] outline-none focus-visible:ring-1 focus-visible:ring-hypertasks-purple"
                />
              )}
              {profile ? (
                <div className="flex min-w-0 items-start gap-2.5">
                  <UserAvatar
                    alt=""
                    name={profile.displayName}
                    photoURL={profile.photoURL ?? ""}
                    size={28}
                  />
                  <div className="min-w-0 flex-1">
                    <p id={headingId} className="truncate text-content font-semibold">
                      {profile.displayName}
                    </p>
                    {email && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyEmail();
                        }}
                        className="group mt-1 flex min-h-[28px] max-w-full items-center gap-1.5 rounded-[3px] text-left text-dense text-text-light-gray outline-none hover:text-white-black focus-visible:ring-1 focus-visible:ring-hypertasks-purple"
                        aria-label={`Copy ${email}`}
                      >
                        <span className="truncate">{email}</span>
                        {copied ? (
                          <Check size={14} aria-hidden="true" className="shrink-0 text-green-500" />
                        ) : (
                          <Copy size={14} aria-hidden="true" className="shrink-0" />
                        )}
                        <span className="sr-only" aria-live="polite">
                          {copied ? "Email copied" : ""}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              ) : query.isError ? (
                <p className="text-dense text-text-light-gray">Contact details unavailable</p>
              ) : (
                <p className="text-dense text-text-light-gray">Loading contact…</p>
              )}
            </section>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
};

const PersonHovercard = ({ projectId, subject, children }: PersonHovercardProps) => {
  if (!projectId || !subject) return children;
  return (
    <PersonHovercardSurface projectId={projectId} subject={subject}>
      {children}
    </PersonHovercardSurface>
  );
};

const ParentPersonHovercard = ({
  projectId,
  subject,
}: {
  projectId?: number;
  subject?: PersonHovercardSubject | null;
}) => {
  const markerRef = useRef<HTMLSpanElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const cancelClose = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 90);
  };

  useEffect(() => {
    const parent = markerRef.current?.parentElement;
    if (!parent || !projectId || !subject) return;
    setAnchor(parent);
    parent.tabIndex = parent.tabIndex >= 0 ? parent.tabIndex : 0;
    parent.setAttribute("aria-haspopup", "dialog");

    const show = () => {
      cancelClose();
      setOpen(true);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    parent.addEventListener("pointerenter", show);
    parent.addEventListener("pointerleave", scheduleClose);
    parent.addEventListener("focusin", show);
    parent.addEventListener("focusout", scheduleClose);
    parent.addEventListener("keydown", dismissOnEscape);
    return () => {
      cancelClose();
      parent.removeEventListener("pointerenter", show);
      parent.removeEventListener("pointerleave", scheduleClose);
      parent.removeEventListener("focusin", show);
      parent.removeEventListener("focusout", scheduleClose);
      parent.removeEventListener("keydown", dismissOnEscape);
    };
  }, [projectId, subject]);

  useEffect(() => {
    if (!anchor) return;
    anchor.setAttribute("aria-expanded", String(open));
  }, [anchor, open]);

  return (
    <>
      <span ref={markerRef} hidden />
      {anchor && subject && (
        <PersonHovercardSurface
          projectId={projectId}
          subject={subject}
          anchor={anchor}
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

export { ParentPersonHovercard, PersonHovercardSurface };
export default PersonHovercard;
