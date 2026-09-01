"use client";

import React, {
  lazy,
  Suspense,
  type ComponentType,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/utils/undoActions/helperFuncs";

export interface MobileBoardViewPickerItem {
  id: string;
  label: string;
  count: number;
}

interface PickerSheetProps {
  isOpen?: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

const LazyMobileBottomSheet: ComponentType<PickerSheetProps> = lazy(() =>
  import("@/components/Modals/Sheets").then((module) => ({
    default: module.MobileBottomSheet,
  })),
);

interface MobileBoardViewPickerProps {
  items: MobileBoardViewPickerItem[];
  activeViewId?: string;
  fallbackLabel: string;
  onSelect: (viewId: string) => Promise<void> | void;
  SheetComponent?: ComponentType<PickerSheetProps>;
}

export const MobileBoardViewPicker = ({
  items,
  activeViewId,
  fallbackLabel,
  onSelect,
  SheetComponent = LazyMobileBottomSheet,
}: MobileBoardViewPickerProps) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const activeItem = useMemo(
    () => items.find((item) => item.id === activeViewId) ?? items[0],
    [activeViewId, items],
  );
  const selectedItemId = activeItem?.id;

  const closePicker = useCallback(() => {
    setOpen(false);
    setSelectingId(null);
    setError(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const setActiveOptionRef = useCallback(
    (node: HTMLButtonElement | null) => {
      if (!node || !open) return;
      window.requestAnimationFrame(() => node.focus());
    },
    [open],
  );

  const selectView = async (viewId: string) => {
    if (viewId === activeViewId) {
      closePicker();
      return;
    }

    setSelectingId(viewId);
    setError(false);
    try {
      await onSelect(viewId);
      closePicker();
    } catch {
      setError(true);
      setSelectingId(null);
    }
  };

  if (!activeItem) {
    return (
      <span className="flex min-w-0 flex-1 items-center truncate text-dense font-semibold text-white-black">
        {fallbackLabel}
      </span>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Switch view. Current view: ${activeItem.label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "mobile-board-view-picker" : undefined}
        onClick={() => {
          setError(false);
          setOpen(true);
        }}
        className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5 text-left text-dense font-semibold text-white-black"
      >
        <span className="min-w-0 truncate">{activeItem.label}</span>
        <span className="shrink-0 text-meta font-normal text-text-light-gray">
          {activeItem.count}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          aria-hidden
          className={cn(
            "shrink-0 text-text-light-gray transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <Suspense fallback={null}>
          <SheetComponent
            isOpen
            onClose={closePicker}
            ariaLabel="Switch view"
          >
            <div id="mobile-board-view-picker" className="pb-[env(safe-area-inset-bottom)]">
              <p className="px-4 pb-1 pt-2 text-micro font-bold uppercase tracking-wider text-text-light-gray">
                Views
              </p>
              <div aria-label="Board views">
                {items.map((item) => {
                  const active = item.id === selectedItemId;
                  const selecting = item.id === selectingId;
                  return (
                    <button
                      key={item.id}
                      ref={active ? setActiveOptionRef : undefined}
                      type="button"
                      aria-current={active ? "true" : undefined}
                      aria-busy={selecting || undefined}
                      disabled={selectingId !== null}
                      onClick={() => void selectView(item.id)}
                      className={cn(
                        "flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-content text-white-black transition-colors duration-75",
                        active && "bg-active-modal-element font-semibold",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="shrink-0 text-meta font-normal text-text-light-gray">
                        {item.count}
                      </span>
                    </button>
                  );
                })}
              </div>
              {error ? (
                <p role="status" className="px-4 py-3 text-meta text-error">
                  Couldn’t switch views. Try again.
                </p>
              ) : null}
            </div>
          </SheetComponent>
        </Suspense>
      ) : null}
    </>
  );
};

export default MobileBoardViewPicker;
