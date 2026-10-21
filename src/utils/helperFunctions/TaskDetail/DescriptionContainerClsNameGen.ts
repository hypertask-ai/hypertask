import { ITaskDetailEditMode } from "@/lib/contexts/TaskDetail/TaskProvider";
import { twMerge } from "tailwind-merge";

export function descriptionContainerClassname({
  isMobile = false,
  containerId = "",
  currentId = "",
  hasDraft = false,
  hasDraftInit = false,
  editMode = null,
  additionalClasses = "",
}: {
  isMobile?: boolean;
  containerId?: string;
  currentId?: string | null;
  hasDraft?: boolean;
  hasDraftInit?: boolean;
  editMode?: ITaskDetailEditMode;
  additionalClasses?: string;
}) {
  const baseClasses =
    "group/descriptionContainer text-emphasis shadow-md rounded-[4px] w-full bg-comment-description outline-none";

  const spacingClasses = isMobile
    ? "py-[10px] my-3 px-[8px]"
    : "pt-[20px] pb-1 mb-[8px] px-[16px]";

  let borderClasses = "border-l-transparent";

  if (hasDraft || hasDraftInit) {
    borderClasses = "shadow-2xl border-l-[#C2CFA5]";
  }
  else if (
    [containerId, "description", "description-input"].includes(currentId || "")
  ) {
    borderClasses = `shadow-2xl ${
      editMode === "description" || editMode === "description-ai"
        ? "border-l-[#C2CFA5]"
        : "border-l-selected-item-border"
    }`;
  }

  return `${baseClasses} ${spacingClasses} ${borderClasses} ${containerId} ${additionalClasses}`.trim();
}

export function createButtonClasses({
  variant = "default",
  size = "medium",
  isActive = false,
  disabled = false,
  additionalClasses = "",
}: {
  variant?: "default" | "primary" | "secondary" | "danger";
  size?: "small" | "medium" | "large";
  isActive?: boolean;
  disabled?: boolean;
  additionalClasses?: string;
}) {
  const baseClasses = "rounded font-medium transition-colors";

  const variantClasses = {
    default: "bg-gray-100 hover:bg-gray-200 text-gray-800",
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    secondary: "bg-gray-200 hover:bg-gray-300 text-gray-800",
    danger: "bg-red-600 hover:bg-red-700 text-white",
  }[variant];

  const sizeClasses = {
    small: "text-content py-1 px-2",
    medium: "text-emphasis py-2 px-4",
    large: "text-subheading py-3 px-6",
  }[size];

  const activeClasses = isActive ? "ring-2 ring-offset-2 ring-blue-500" : "";

  const disabledClasses = disabled
    ? "opacity-50 cursor-not-allowed"
    : "cursor-pointer";

  return `${baseClasses} ${variantClasses} ${sizeClasses} ${activeClasses} ${disabledClasses} ${additionalClasses}`.trim();
}

export function cx(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
