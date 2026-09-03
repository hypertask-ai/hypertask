import { X } from "lucide-react";

// Shared with AI Chat's composer (AI_Tiptap_Container.tsx), which had its own
// copy of this markup before Agent Chat needed the same "follow-ups queued
// while a reply is in flight" strip (HTPR-6038).
export function QueuedMessagesStrip({
  items,
  onRemove,
}: {
  items: { id: string; content: string }[];
  onRemove: (id: string) => void;
}) {
  return (
    <div
      className="mb-2 flex w-full flex-col gap-1.5 rounded-[5px] border border-border-light-gray-thin bg-containerBackground p-2"
      aria-label="Queued messages"
    >
      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-text-light-gray">
        <span>Queued · sends when reply finishes</span>
        <span>{items.length}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-[4px] bg-newcomment-well px-2 py-1.5 text-meta text-white-black"
          >
            <span
              className="shrink-0 text-[10px] font-bold text-text-light-gray"
              aria-hidden="true"
            >
              {index + 1}.
            </span>
            <span className="min-w-0 flex-1 truncate">{item.content}</span>
            <button
              type="button"
              className="shrink-0 text-icon-dark-gray hover:text-white-black"
              aria-label="Remove queued message"
              onClick={() => onRemove(item.id)}
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
