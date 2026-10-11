// Same label as My Tasks (MyTasksBulkActionBar), shown while inbox messages are selected.
// Inbox decides whether this renders at all, behind the HTPR-7111 flag.
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
