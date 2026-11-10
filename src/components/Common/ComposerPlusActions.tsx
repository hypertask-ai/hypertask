import { Plus } from "lucide-react";
import { useEffect, useRef } from "react";

const menuItemClass =
  "flex items-center justify-between gap-6 rounded-[4px] px-2 py-1.5 text-left text-meta text-white-black hover:bg-hover-active disabled:opacity-50";

export function ComposerPlusActions({
  disabled,
  attachShortcut,
  onAttach,
  onAddContext,
  active = true,
}: {
  disabled?: boolean;
  attachShortcut?: string;
  onAttach: () => void;
  onAddContext: () => void;
  active?: boolean;
}) {
  const plusMenu = useRef<HTMLDetailsElement>(null);
  const closePlusMenu = () => {
    if (plusMenu.current) plusMenu.current.open = false;
  };

  useEffect(() => {
    if (!active) closePlusMenu();
  }, [active]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const menu = plusMenu.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !plusMenu.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      closePlusMenu();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return (
    <details ref={plusMenu} className="relative">
      <summary
        aria-label="Add"
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-[4px] text-icon-dark-gray hover:bg-hover-active hover:text-white-black [&::-webkit-details-marker]:hidden"
      >
        <Plus size={18} strokeWidth={1.75} aria-hidden />
      </summary>
      <div role="group" aria-label="Add" className="absolute bottom-[calc(100%+0.25rem)] left-0 z-popup flex min-w-44 flex-col rounded-[4px] bg-modalBackground p-1 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
        <button type="button" aria-label="Attach file" disabled={disabled}
          className={menuItemClass}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { closePlusMenu(); onAttach(); }}>
          <span>Attach file</span>
          {attachShortcut && <span className="text-text-light-gray">{attachShortcut}</span>}
        </button>
        <button type="button" aria-label="Add context" disabled={disabled}
          className={menuItemClass}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { closePlusMenu(); onAddContext(); }}>
          <span>Add context</span>
          <span className="text-text-light-gray">@</span>
        </button>
      </div>
    </details>
  );
}
