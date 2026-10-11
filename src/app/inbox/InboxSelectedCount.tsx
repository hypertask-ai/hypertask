// Same label as My Tasks (MyTasksBulkActionBar), shown while inbox messages are selected.
export const InboxSelectedCount = ({
  enabled,
  count,
}: {
  enabled: boolean;
  count: number;
}) =>
  enabled && count > 0 ? (
    <span
      className="whitespace-nowrap pr-1 text-content text-white-black"
      role="status"
      aria-live="polite"
    >
      {count} selected
    </span>
  ) : null;
