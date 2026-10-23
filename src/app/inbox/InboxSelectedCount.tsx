export const InboxSelectedCount = ({ count }: { count: number }) =>
  count > 0 ? (
    <span
      className="whitespace-nowrap pr-1 text-content text-white-black"
      role="status"
      aria-live="polite"
    >
      {count} selected
    </span>
  ) : null;
