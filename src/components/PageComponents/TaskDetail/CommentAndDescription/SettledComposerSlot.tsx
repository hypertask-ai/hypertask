import type { ReactNode, Ref } from "react";

// HTPR-7074: the comment box is mounted at once in its normal place, so it takes its space and
// the thread lands where it always did, but stays invisible and untouchable until the thread
// has settled. visibility:hidden moves do not count as layout shift. When settled (and always
// when the fix is off or does not apply) nothing is added besides a layout-neutral wrapper.
export function SettledComposerSlot({ settled, slotRef, children }: { settled: boolean; slotRef?: Ref<HTMLDivElement>; children: ReactNode }) {
  const hold = settled ? {} : { inert: true, "aria-hidden": true, style: { display: "contents", visibility: "hidden" as const } };
  return <div ref={slotRef} data-composer-slot-settled={settled} style={{ display: "contents" }} {...hold}>{children}</div>;
}
