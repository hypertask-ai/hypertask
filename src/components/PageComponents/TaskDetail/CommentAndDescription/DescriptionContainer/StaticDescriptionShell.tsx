"use client";
/* eslint-disable tailwindcss/no-custom-classname -- these are the editor's own app-defined class names */

import { useMemo, type CSSProperties, type MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/styles/tiptap.module.scss";
import dragStyles from "@/styles/FileDragAndDrop.module.scss";
import { taskDetailSpacing } from "@/lib/configs/taskDetail.config";
import {
  isInternalTaskDetailHref,
  preserveInboxFlowOnTaskHref,
  shouldFollowLinkNatively,
} from "@/lib/taskDetailInboxFlow";
import { cn } from "@/utils/undoActions/helperFuncs";
import { toEditorHtml } from "./staticDescriptionHtml";

const PROSEMIRROR_ROOT_STYLE: CSSProperties = {
  position: "relative",
  wordWrap: "break-word",
  whiteSpace: "break-spaces",
  fontVariantLigatures: "none",
  fontFeatureSettings: '"liga" 0',
};

export type DescriptionIntentProps = {
  onPointerDownCapture: () => void;
  onFocusCapture: () => void;
  onKeyDownCapture: () => void;
};

/**
 * HTPR-7091: what a ticket's read-only description looks like, drawn without
 * the editor. The class names copy TiptapMainContainer and TiptapEditor for the
 * read-only description, so the editor takes over in the same place at the
 * same size.
 */
export function StaticDescriptionBody({ html, isMbl }: { html: string; isMbl: boolean }) {
  const content = useMemo(() => toEditorHtml(html), [html]);
  const text = (
    <div className="">
      <div
        contentEditable={false}
        translate="no"
        className="tiptap ProseMirror"
        // The editor adds these rules for .ProseMirror when it starts, so the copy sets them itself.
        style={PROSEMIRROR_ROOT_STYLE}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  );

  if (isMbl) {
    return (
      <div
        id="description"
        tabIndex={0}
        style={{ borderLeftWidth: 0 }}
        className={`w-full min-h-[64px] scrollbar-none bg-comment-description description-edit-container ${styles.hellow} outline-none flex-wrap border-transparent py-1 border-0 w-full items-center bg-transparent px-0`}
      >
        <div
          id="description-input"
          tabIndex={-1}
          className={`w-full min-w-0 relative col-[1_/_3] min-h-[78px] scrollbar-none @sm:max-h-full max-w-[85cqw] @sm:max-w-[560px] @md:max-w-full break-normal ${styles.editorContainer} ${styles.readOnlyDescription} mt-2 ${styles.unstacked}`}
        >
          {text}
        </div>
      </div>
    );
  }
  return (
    <div
      id="description"
      tabIndex={0}
      style={{ borderLeftWidth: 0 }}
      className={`w-full flex flex-col scrollbar-none items-center bg-comment-description description-edit-container ${styles.hellow} outline-none items-center bg-transparent px-0`}
    >
      <div className={dragStyles.container}>
        <div
          id="description-input"
          tabIndex={-1}
          className={`transition-all w-full duration-[40ms] col-[1_/_3] scrollbar-none @sm:max-h-full max-w-[85cqw] @sm:max-w-[560px] @md:max-w-full break-normal ${styles.editorContainer} ${styles.readOnlyDescription} mt-2 ${styles.unstacked}`}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

/** The description's wrapper from TaskDetailEditorPanels plus the static body. */
export default function StaticDescriptionShell({
  html,
  isMbl,
  intent,
}: {
  html: string;
  isMbl: boolean;
  intent: DescriptionIntentProps;
}) {
  const router = useRouter();
  const inboxFlow = useSearchParams()?.get("inboxFlow");

  // Same as the editor wrapper: a task link opens in the app, not a new page.
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const href = target.closest("a")?.getAttribute("href");
    if (href && isInternalTaskDetailHref(href)) {
      if (shouldFollowLinkNatively(event)) return;
      event.preventDefault();
      router.push(preserveInboxFlowOnTaskHref(href, inboxFlow));
    }
  };

  return (
    <div
      id="main-wrapper-description"
      {...intent}
      onClickCapture={onClickCapture}
      className={cn(
        "col-start-1 col-end-3 relative text-white-black",
        isMbl ? taskDetailSpacing.mobile.descriptionContainer : "",
      )}
    >
      <div id="popover-wrapper-description" className="w-full absolute z-[1000] hidden h-0" />
      <StaticDescriptionBody html={html} isMbl={isMbl} />
      <button className="hidden" id="popover-button-description" />
    </div>
  );
}
