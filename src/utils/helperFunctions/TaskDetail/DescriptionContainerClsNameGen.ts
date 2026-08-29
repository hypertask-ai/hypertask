// classNameUtils.ts
import { ITaskDetailEditMode } from "@/lib/contexts/TaskDetail/TaskProvider";
import { twMerge } from "tailwind-merge"; // Optional: helps merge tailwind classes efficiently

/**
 * Creates consistent container styles
 * @param options Configuration options
 * @returns Class string
 */
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
  // Base classes that are always applied
  const baseClasses =
    "group/descriptionContainer text-emphasis shadow-md rounded-[4px] w-full bg-comment-description outline-none";

  // Spacing classes based on mobile/desktop
  const spacingClasses = isMobile
    ? "py-[10px] my-3 px-[8px]"
    : "pt-[20px] pb-1 mb-[8px] px-[16px]";

  // Dynamic border based on selection/edit state
  let borderClasses = "border-l-transparent";

  // Handle draft state
  if (hasDraft || hasDraftInit) {
    borderClasses = "shadow-2xl border-l-[#C2CFA5]";
  }
  // Handle selected state
  else if (
    [containerId, "description", "description-input"].includes(currentId || "")
  ) {
    borderClasses = `shadow-2xl ${
      editMode === "description" || editMode === "description-ai"
        ? "border-l-[#C2CFA5]"
        : "border-l-selected-item-border"
    }`;
  }

  // Combine all classes
  return `${baseClasses} ${spacingClasses} ${borderClasses} ${containerId} ${additionalClasses}`.trim();
}

/**
 * Creates consistent button styles
 */
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
  // Base button classes
  const baseClasses = "rounded font-medium transition-colors";

  // Variant classes
  const variantClasses = {
    default: "bg-gray-100 hover:bg-gray-200 text-gray-800",
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    secondary: "bg-gray-200 hover:bg-gray-300 text-gray-800",
    danger: "bg-red-600 hover:bg-red-700 text-white",
  }[variant];

  // Size classes
  const sizeClasses = {
    small: "text-content py-1 px-2",
    medium: "text-emphasis py-2 px-4",
    large: "text-subheading py-3 px-6",
  }[size];

  // Active state
  const activeClasses = isActive ? "ring-2 ring-offset-2 ring-blue-500" : "";

  // Disabled state
  const disabledClasses = disabled
    ? "opacity-50 cursor-not-allowed"
    : "cursor-pointer";

  return `${baseClasses} ${variantClasses} ${sizeClasses} ${activeClasses} ${disabledClasses} ${additionalClasses}`.trim();
}

/**
 * Utility to conditionally join class names
 */
export function cx(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
