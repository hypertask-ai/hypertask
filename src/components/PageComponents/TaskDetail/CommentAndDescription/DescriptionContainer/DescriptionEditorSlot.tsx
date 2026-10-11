"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { TiptapProps } from "@/components/RTE/useTaskDetailEditorState";
import StaticDescriptionShell, { StaticDescriptionBody, type DescriptionIntentProps } from "./StaticDescriptionShell";
import { StaticDescriptionPlaceholderContext } from "./StaticDescriptionPlaceholder";

type EditorComponent = ComponentType<TiptapProps>;

const importEditor = () => import("@/components/RTE/TipTapTaskDetail");

// Flag off: the editor is still its own chunk, but it renders on the server and
// mounts with the page like before.
const EagerEditor = dynamic(importEditor);

let loadedEditor: EditorComponent | null = null;
let pendingEditor: Promise<EditorComponent> | null = null;

export function preloadDescriptionEditor(): Promise<EditorComponent> {
  pendingEditor ??= importEditor().then((module) => (loadedEditor = module.default));
  return pendingEditor;
}

const preload = () => void preloadDescriptionEditor();
const intentProps: DescriptionIntentProps = {
  onPointerDownCapture: preload,
  onFocusCapture: preload,
  onKeyDownCapture: preload,
};

/**
 * HTPR-7091: with `lazy`, the slot shows the description as static HTML (a copy
 * of the editor's read-only markup) until the editor chunk has loaded, then
 * hands over in place. The choice is made once per mount so an open editor is
 * never swapped.
 */
export default function DescriptionEditorSlot({
  lazy: lazyRequested,
  ...editorProps
}: TiptapProps & { lazy: boolean }) {
  const [lazy] = useState(lazyRequested);
  const [Editor, setEditor] = useState<EditorComponent | null>(() => loadedEditor);
  const { defaultContent, isMbl } = editorProps;
  const placeholder = useMemo(
    () => <StaticDescriptionBody html={defaultContent ?? ""} isMbl={!!isMbl} />,
    [defaultContent, isMbl],
  );

  useEffect(() => {
    if (!lazy) return;
    let live = true;
    preloadDescriptionEditor().then((component) => {
      if (live) setEditor(() => component);
    });
    return () => {
      live = false;
    };
  }, [lazy]);

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
