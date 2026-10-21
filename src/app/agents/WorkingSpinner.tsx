import { cn } from "@/utils/undoActions/helperFuncs";

export default function WorkingSpinner({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn(
        "w-2 h-2 shrink-0 rounded-full border border-hypertasks-purple",
        "border-t-transparent animate-spin",
        className,
      )}
    />
  );
}
