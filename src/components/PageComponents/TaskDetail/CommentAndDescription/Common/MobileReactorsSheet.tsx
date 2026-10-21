import { IReaction, IUser } from "@/models/model";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import NativeEmoji from "./NativeEmoji";
import UserAvatar from "@/components/Common/UserAvatar";

interface MobileReactorsSheetProps {
  reaction: IReaction;
  currentUser: IUser;
  semantic: string;
  onRemoveOwn?: () => void;
  onClose: () => void;
}

const MobileReactorsSheet = ({
  reaction,
  currentUser,
  semantic,
  onRemoveOwn,
  onClose,
}: MobileReactorsSheetProps) => {
  const portalRoot =
    typeof document === "undefined"
      ? null
      : document.getElementById("portal-root");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  if (!portalRoot) return null;

  const users = reaction?.users ?? [];

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[9998] bg-black/40"
        onPointerDown={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Reacted with ${semantic}`}
        className="reactors-sheet fixed inset-x-0 bottom-0 z-[9999] flex max-h-[70vh] w-full flex-col overflow-hidden overscroll-contain rounded-t-[12px] bg-modalBackground text-white-black shadow-[0_-8px_24px_rgba(0,0,0,0.35)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex h-6 shrink-0 items-center justify-center">
          <span className="h-1 w-9 rounded-full bg-[#4F5766]" />
        </div>

        <div className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-1">
          <NativeEmoji unified={reaction.unified} size={22} />
          <span className="text-content text-text-light-gray">
            Reacted with {semantic}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {users.map((user, index) => {
            const isCurrentUser = user.id != null && user.id === currentUser?.id;
            return (
              <div
                key={user.id ?? `agent-${index}`}
                className="flex items-center gap-3 rounded-[6px] px-2 py-2"
              >
                <UserAvatar
                  alt=""
                  name={user.displayName}
                  photoURL={user.photoURL}
                  size={28}
                  title={user.displayName}
                />
                <span className="flex-1 truncate text-content">
                  {isCurrentUser ? "You" : user.displayName}
                </span>
                {isCurrentUser && onRemoveOwn && (
                  <button
                    type="button"
                    className="shrink-0 text-meta text-text-light-gray"
                    onClick={() => {
                      onRemoveOwn();
                      onClose();
                    }}
                  >
                    Tap to remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>,
    portalRoot
  );
};

export default MobileReactorsSheet;
