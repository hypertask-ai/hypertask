import { IUser } from "@/models/model";
import { cn } from "@/utils/undoActions/helperFuncs";
import UserAvatar from "@/components/Common/UserAvatar";

const actionButtonClass =
  "inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-dense font-semibold text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-light-gray";

interface SettingsMemberRowProps {
  canRemove?: boolean;
  canToggleRole?: boolean;
  onRemove?: () => void;
  onToggleRole?: () => void;
  role: "Admin" | "Member";
  togglingRole?: boolean;
  user: IUser;
}

const SettingsMemberRow: React.FC<SettingsMemberRowProps> = ({
  canRemove = false,
  canToggleRole = false,
  onRemove,
  onToggleRole,
  role,
  togglingRole = false,
  user,
}) => {
  const displayName = user.displayName || user.email || "Member";

  return (
    <div className="flex items-center gap-3 rounded-[5px] px-2 py-2 hover:bg-hover-active">
      <UserAvatar
        alt=""
        name={displayName}
        photoURL={user.photoURL}
        size={24}
        title={displayName}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-dense font-medium text-white-black">
          {displayName}
        </div>
        {user.email && user.email !== displayName && (
          <div className="truncate text-meta font-medium text-text-light-gray">
            {user.email}
          </div>
        )}
      </div>
      <span
        className={cn(
          "rounded-[5px] bg-active-modal-element px-1.5 py-[1px] text-micro font-medium text-text-light-gray",
          role === "Admin" && "text-white-black"
        )}
      >
        {role}
      </span>
      {canToggleRole && onToggleRole && (
        <button
          className={actionButtonClass}
          disabled={togglingRole}
          onClick={onToggleRole}
          type="button"
        >
          {togglingRole
            ? "Updating…"
            : role === "Admin"
              ? "Remove admin"
              : "Make admin"}
        </button>
      )}
      {canRemove && onRemove && (
        <button className={actionButtonClass} onClick={onRemove} type="button">
          Remove
        </button>
      )}
    </div>
  );
};

export default SettingsMemberRow;
