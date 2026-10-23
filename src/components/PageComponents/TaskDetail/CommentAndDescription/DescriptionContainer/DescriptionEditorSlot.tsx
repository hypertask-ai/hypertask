"use client";

import dynamic from "next/dynamic";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7395_CACHED_STATIC_FIRST_FLAG } from "@/lib/flags/keys";
import type { TiptapProps } from "@/components/RTE/useTaskDetailEditorState";
import StaticDescriptionShell, { StaticDescriptionBody, type DescriptionIntentProps } from "./StaticDescriptionShell";
import { StaticDescriptionPlaceholderContext } from "./StaticDescriptionPlaceholder";

type EditorComponent = ComponentType<TiptapProps>;

let editorModuleWarm = false;
const importEditor = () => import("@/components/RTE/TipTapTaskDetail").then((module) => {
  editorModuleWarm = true;
  return module;
});

const EagerEditor = dynamic(importEditor);

let loadedEditor: EditorComponent | null = null;
let pendingEditor: Promise<EditorComponent> | null = null;

export function preloadDescriptionEditor(): Promise<EditorComponent> {
  pendingEditor ??= importEditor().then(
    (module) => (loadedEditor = module.default),
    (error) => {
      pendingEditor = null;
      throw error;
    },
  );
  return pendingEditor;
}

export default function DescriptionEditorSlot({
  lazy: lazyRequested,
  afterPaint: afterPaintRequested = false,
  ...editorProps
}: TiptapProps & { lazy: boolean; afterPaint?: boolean }) {
  const cachedStaticFirst = useFlag(HTPR_7395_CACHED_STATIC_FIRST_FLAG);
  const [afterPaint] = useState(afterPaintRequested && cachedStaticFirst && !editorModuleWarm);
  const [lazy] = useState(lazyRequested || afterPaint);
  const [Editor, setEditor] = useState<EditorComponent | null>(() => afterPaint ? null : loadedEditor);
  const { defaultContent, isMbl } = editorProps;
  const placeholder = useMemo(
    () => <StaticDescriptionBody html={defaultContent ?? ""} isMbl={!!isMbl} />,
    [defaultContent, isMbl],
  );

  const liveRef = useRef(true);
  const load = useCallback(() => {
    preloadDescriptionEditor().then(
      (component) => {
        if (!liveRef.current) return;
        if (afterPaint) startTransition(() => setEditor(() => component));
        else setEditor(() => component);
      },
      () => {},
    );
  }, [afterPaint]);
  const intentProps = useMemo<DescriptionIntentProps>(
    () => ({ onPointerDownCapture: load, onFocusCapture: load, onKeyDownCapture: load }),
    [load],
  );

  useEffect(() => {
    if (!lazy) return;
    liveRef.current = true;
    let frame: number | undefined;
    if (afterPaint) {
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(load);
      });
    } else load();
    return () => {
      liveRef.current = false;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [lazy, afterPaint, load]);

  if (!lazy) return <EagerEditor {...editorProps} />;
  if (!Editor) {
    return <StaticDescriptionShell html={defaultContent ?? ""} isMbl={!!isMbl} intent={intentProps} />;
  }
  return (
    <StaticDescriptionPlaceholderContext.Provider value={placeholder}>
      <Editor {...editorProps} />
    </StaticDescriptionPlaceholderContext.Provider>
  );
}
