import type { ReactNode, Ref } from "react";

export function SettledComposerSlot({ settled, slotRef, children }: { settled: boolean; slotRef?: Ref<HTMLDivElement>; children: ReactNode }) {
  const hold = settled ? {} : { inert: true, "aria-hidden": true, style: { display: "contents", visibility: "hidden" as const } };
  return <div ref={slotRef} data-composer-slot-settled={settled} style={{ display: "contents" }} {...hold}>{children}</div>;
}
