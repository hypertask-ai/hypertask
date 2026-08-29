import { cn } from "@/utils/undoActions/helperFuncs";

/**
 * Sits where the status dot sits, same size, so a card gains no new chrome when
 * an agent picks up work — the dot just starts turning.
 */
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
        // One transparent edge is what makes the ring read as spinning.
        "border-t-transparent animate-spin",
        className,
      )}
    />
  );
}
